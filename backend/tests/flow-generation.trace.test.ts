import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { MemorySaver } from '@langchain/langgraph'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { analysisTraceConfig, traceStep } from '../src/ai/observability/langsmith'
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app/createApp'
import { generateFlow } from '../src/services/flow-generation.service'
import { getCodeFlowCheckpointer } from '../src/ai/graph/checkpointer'
import * as checkpointModule from '../src/ai/graph/checkpointer'
import { code, result, createModelServer } from './fixtures/model.fixture'

// 验证 HTTP / SSE 与 LangSmith 上下文，语言检测使用固定结果，避免外部调用。
vi.mock('../src/ai/tools/detect-language.tool', () => ({
  runDetectLanguage: vi.fn(async () => ({
    language: 'javascript',
    confidence: 1,
    status: 'detected'
  }))
}))

let dir: string
let server: Awaited<ReturnType<typeof createModelServer>> | undefined
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'code2flow-http-'))
})
beforeEach(() => {
  vi.stubEnv('LANGSMITH_TRACING', 'false')
  vi.stubEnv('CODE2FLOW_MAX_RETRIES', '0')
  vi.stubEnv('CODE2FLOW_CHECKPOINT_DB', join(dir, 'http.sqlite'))
})
afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
afterAll(async () => {
  getCodeFlowCheckpointer().db.close()
  await rm(dir, { recursive: true, force: true })
})

async function useModel(replies: Parameters<typeof createModelServer>[0]) {
  // 生成工具仅提交图和映射，语言由 Jev 补齐。
  server = await createModelServer(
    replies.map((reply) => ({
      ...reply,
      args: reply.args ?? { mermaid: result.mermaid, mappings: result.mappings }
    }))
  )
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-only')
  vi.stubEnv('DEEPSEEK_BASE_URL', server.baseURL)
  return server
}
const parseEvents = (body: string) =>
  body
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)))

describe('HTTP / SSE and service observability', () => {
  it('保留真实 Agent 和模型的父子关联、输入输出及供应商用量', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'false')
    vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-chat')
    await useModel([{}])
    const starts: Array<{
      id: string
      parent?: string
      name?: string
      metadata?: Record<string, unknown>
    }> = []
    const llmEnd = vi.fn()
    const callback = BaseCallbackHandler.fromMethods({
      handleChainStart(_chain, _input, id, parent, _tags, metadata, _runType, name) {
        starts.push({ id, parent, name, metadata })
      },
      handleChatModelStart(_model, _messages, id, parent, _extra, _tags, metadata, name) {
        starts.push({ id, parent, name, metadata })
      },
      handleLLMEnd: llmEnd
    })
    await traceStep('test-observer', {}, () => generateFlow({ code }), {
      ...analysisTraceConfig('generate', 'visible-session'),
      callbacks: [callback]
    })
    const root = starts.find((run) => run.name === 'code2flow.generate')!
    const graph = starts.find((run) => run.name === 'code2flow.graph')!
    const node = starts.find((run) => run.name === 'analyze')!
    const agent = starts.find((run) => run.name === 'code2flow.generate-agent')!
    expect(graph.parent).toBe(root.id)
    expect(node.parent).toBe(graph.id)
    expect(agent.parent).toBe(node.id)
    const model = starts.find((run) => run.metadata?.ls_provider === 'deepseek')!
    expect(model.metadata).toMatchObject({
      session_id: 'visible-session',
      ls_model_name: 'deepseek-chat'
    })
    expect(llmEnd).toHaveBeenCalledTimes(1)
    const message = llmEnd.mock.calls[0][0].generations[0][0].message
    expect(message.usage_metadata).toMatchObject({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30
    })
  })
  it('keeps one-shot generation out of the persistent checkpoint store', async () => {
    await useModel([{}])
    const saver = vi.spyOn(checkpointModule, 'getCodeFlowCheckpointer')
    await request(createApp()).post('/api/generate-flow').send({ code }).expect(200)
    expect(saver).not.toHaveBeenCalled()
  })
  it('preserves the SSE contract and completes a real HTTP follow-up', async () => {
    const model = await useModel([{}, { text: '这是赋值节点。' }])
    const app = createApp()
    const response = await request(app)
      .post('/api/generate-flow')
      .send({ code, thread_id: 'http-flow' })
      .expect(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    const events = parseEvents(response.text)
    expect(events[0].type).toBe('metadata')
    expect(events.filter((event) => event.type === 'mermaid').length).toBeGreaterThan(1)
    expect(events.slice(-3).map((event) => event.type)).toEqual(['mermaid', 'mappings', 'done'])
    expect(events[events.length - 2].content[0].nodeId).toBe('n_start_1')
    const followup = await request(app)
      .post('/api/follow-up')
      .send({ thread_id: 'http-flow', question: '为什么这样画' })
      .expect(200)
    expect(followup.body).toEqual({
      thread_id: 'http-flow',
      question: '为什么这样画',
      explanation: '这是赋值节点。'
    })
    const restored = await request(app).get('/api/sessions/http-flow').expect(200)
    expect(restored.body.sourceCode).toBe(code)
    expect(restored.body.result.mappings).toEqual(result.mappings)
    expect(restored.body.messages).toEqual([
      { role: 'user', content: '为什么这样画' },
      { role: 'assistant', content: '这是赋值节点。' }
    ])
    expect(restored.body.busy).toBe(false)
    expect(model.requests).toHaveLength(2)
  })

  it('rejects invalid request bodies before calling the model', async () => {
    const model = await useModel([])
    await request(createApp()).post('/api/generate-flow').send({ code: '' }).expect(400)
    await request(createApp()).post('/api/follow-up').send({ thread_id: 'x' }).expect(400)
    expect(model.requests).toHaveLength(0)
  })

  it('emits error without done when the model fails', async () => {
    await useModel([{ status: 503 }])
    const response = await request(createApp())
      .post('/api/generate-flow')
      .send({ code, thread_id: 'failed-http' })
      .expect(200)
    const events = parseEvents(response.text)
    expect(events[events.length - 1].type).toBe('error')
    expect(events.some((event) => event.type === 'done')).toBe(false)
  })

  it('将真实服务失败传播到请求级追踪', async () => {
    const model = await useModel([{ status: 401 }])
    const errors = vi.fn()
    await expect(
      traceStep(
        'request',
        {},
        () =>
          generateFlow(
            { code, maxRetries: 0 },
            { model: model.model, checkpointer: new MemorySaver() }
          ),
        { callbacks: [BaseCallbackHandler.fromMethods({ handleChainError: errors })] }
      )
    ).rejects.toThrow()
    expect(errors).toHaveBeenCalled()
  })

  it('accumulates provider usage across a real graph retry', async () => {
    const model = await useModel([{ args: { mermaid: 'invalid', mappings: [] } }, {}])
    let totalTokens = 0
    const usage = vi.fn((output) => {
      totalTokens += output.generations[0][0].message.usage_metadata.total_tokens
    })
    await traceStep(
      'request',
      {},
      () => generateFlow({ code, maxRetries: 1 }, { model: model.model }),
      {
        callbacks: [BaseCallbackHandler.fromMethods({ handleLLMEnd: usage })]
      }
    )
    expect(usage).toHaveBeenCalledTimes(2)
    expect(totalTokens).toBe(60)
  })

  it('旧用量接口已移除', async () => {
    await request(createApp()).get('/api/usage').expect(404)
  })
})
