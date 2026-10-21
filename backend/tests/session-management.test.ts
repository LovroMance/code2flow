import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionService } from '../src/services/session.service'
import * as sessionModule from '../src/services/session.service'
import { withSessionLock } from '../src/services/session-lock'
import { createCodeFlowGraph } from '../src/ai/graph/code-flow.graph'
import { createApp } from '../src/app/createApp'
import { loadLegacyCheckpoint } from '../src/ai/graph/checkpointer'
import { code, result } from './fixtures/model.fixture'

const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const close of cleanup.splice(0).reverse()) await close()
})
function setup() {
  const saver = SqliteSaver.fromConnString(':memory:')
  cleanup.push(() => saver.db.close())
  return { saver, service: new SessionService(saver) }
}
async function seed(saver: SqliteSaver, id: string, source = code) {
  await createCodeFlowGraph({ checkpointer: saver }).updateState(
    { configurable: { thread_id: id } },
    {
      code: source,
      result,
      detectedLanguage: 'javascript',
      messages: [new HumanMessage('为什么？'), new AIMessage('这是分支。')]
    },
    'validate'
  )
}

describe('会话目录与 LangGraph 状态恢复', () => {
  it('登记已有检查点，完整恢复源码、图、映射与问答，且不混用线程', async () => {
    const { saver, service } = setup()
    await seed(saver, 'first')
    await seed(saver, 'second', 'otherSource()')
    const list = await service.list()
    expect(list.map((item) => item.id).sort()).toEqual(['first', 'second'])
    const detail = await service.get('first')
    expect(detail.sourceCode).toBe(code)
    expect(detail.draftCode).toBe(code)
    expect(detail.result).toEqual(result)
    expect(detail.messages).toEqual([
      { role: 'user', content: '为什么？' },
      { role: 'assistant', content: '这是分支。' }
    ])
    expect((await service.get('second')).sourceCode).toBe('otherSource()')
    expect(list[0]).not.toHaveProperty('draftCode')
    expect(list[0]).not.toHaveProperty('messages')
  })

  it('保存和重命名草稿不会覆盖分析源码或清空旧图', async () => {
    const { saver, service } = setup()
    await seed(saver, 'draft')
    await service.list()
    const updated = await service.update('draft', {
      title: '订单流程',
      fileName: 'order.py',
      draftCode: 'print("修改")',
      draftLanguage: 'python'
    })
    expect(updated.busy).toBe(false)
    expect(updated.hasDraft).toBe(true)
    expect(updated.sourceCode).toBe(code)
    expect(updated.result).toEqual(result)
    expect(updated.draftCode).toBe('print("修改")')
    expect((await service.get('draft')).title).toBe('订单流程')
  })

  it('新建空会话没有旧图和问答，重复 ID 不覆盖已有内容', async () => {
    const { service } = setup()
    const detail = await service.create({ id: 'new', title: '新任务', draftCode: '' })
    expect(detail.busy).toBe(false)
    expect(detail.result).toBeNull()
    expect(detail.messages).toEqual([])
    await expect(service.create({ id: 'new', draftCode: 'overwrite()' })).rejects.toThrow('已存在')
    expect((await service.get('new')).draftCode).toBe('')
  })

  it('数据库重开后保留目录、草稿和框架检查点', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-sessions-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'sessions.sqlite')
    const first = SqliteSaver.fromConnString(file)
    try {
      const service = new SessionService(first)
      await seed(first, 'persisted')
      await service.list()
      await service.update('persisted', { title: '持久会话', draftCode: 'savedDraft()' })
    } finally {
      first.db.close()
    }
    const second = SqliteSaver.fromConnString(file)
    cleanup.push(() => second.db.close())
    const restored = await new SessionService(second).get('persisted')
    expect(restored.title).toBe('持久会话')
    expect(restored.draftCode).toBe('savedDraft()')
    expect(restored.result).toEqual(result)
    expect(restored.messages).toHaveLength(2)
  })

  it('删除仅清理目标线程及其检查点，保留其他会话', async () => {
    const { saver, service } = setup()
    await seed(saver, 'remove')
    await seed(saver, 'keep')
    await service.delete('remove')
    await expect(service.get('remove')).rejects.toThrow('不存在')
    expect(await saver.getTuple({ configurable: { thread_id: 'remove' } })).toBeUndefined()
    expect((await service.list()).map((item) => item.id)).toEqual(['keep'])
    expect((await service.get('keep')).result).toEqual(result)
  })

  it('同线程请求互斥，处理中禁止保存和删除，其他线程仍可操作', async () => {
    const { service } = setup()
    await service.create({ id: 'locked' })
    await withSessionLock('locked', async () => {
      expect((await service.get('locked')).busy).toBe(true)
      await expect(service.delete('locked')).rejects.toThrow('正在处理')
      await expect(service.update('locked', { title: '不应写入' })).rejects.toThrow('正在处理')
      await expect(withSessionLock('locked', async () => undefined)).rejects.toThrow('正在处理')
      await service.create({ id: 'other' })
    })
    expect((await service.get('locked')).busy).toBe(false)
    await service.update('locked', { title: '锁已释放' })
  })

  it('删除标记阻止旧 JSON 会话复活，兼容源文件保持只读', async () => {
    const { saver, service } = setup()
    const dir = await mkdtemp(join(tmpdir(), 'code2flow-deleted-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'legacy.json')
    const original = JSON.stringify({ 'generate:deleted': { code, result } })
    await writeFile(file, original)
    vi.stubEnv('CODE2FLOW_CHECKPOINT_FILE', file)
    await seed(saver, 'deleted')
    await service.delete('deleted')
    expect(await loadLegacyCheckpoint('deleted', saver)).toBeUndefined()
    expect(() => service.ensure('deleted')).toThrow('已删除')
    expect(await readFile(file, 'utf8')).toBe(original)
  })

  it('通过 HTTP 创建、读取、重命名和删除，校验请求及 404', async () => {
    const { service } = setup()
    vi.spyOn(sessionModule, 'getSessionService').mockReturnValue(service)
    const app = createApp()
    await request(app)
      .post('/api/sessions')
      .send({ id: 'http', draftCode: 'hello()', title: '任务' })
      .expect(201)
    const list = await request(app).get('/api/sessions').expect(200)
    expect(list.body.sessions).toHaveLength(1)
    await request(app)
      .patch('/api/sessions/http')
      .send({ title: '新名称', draftLanguage: 'python' })
      .expect(200)
    const detail = await request(app).get('/api/sessions/http').expect(200)
    expect(detail.body.title).toBe('新名称')
    await request(app).post('/api/sessions').send({ title: '' }).expect(400)
    await request(app).patch('/api/sessions/http').send({ draftLanguage: 'invalid' }).expect(400)
    await request(app).get('/api/sessions/missing').expect(404)
    await withSessionLock('http', async () => {
      await request(app).delete('/api/sessions/http').expect(409)
    })
    await request(app).delete('/api/sessions/http').expect(204)
    await request(app).get('/api/sessions/http').expect(404)
  })
})
