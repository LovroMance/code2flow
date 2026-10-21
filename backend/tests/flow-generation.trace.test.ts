import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { MemorySaver } from '@langchain/langgraph'
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app/createApp'
import { generateFlow } from '../src/services/flow-generation.service'
import { createTraceCollector } from '../src/ai/observability/trace.builder'
import { getCodeFlowCheckpointer } from '../src/ai/graph/checkpointer'
import * as checkpointModule from '../src/ai/graph/checkpointer'
import { resetTraceSinkForTesting } from '../src/ai/observability/trace.sink'
import { code, result, createModelServer } from './fixtures/model.fixture'

// 此处验证生成与用量链路，语言检测使用固定结果，避免依赖真实 Jev 配置或网络。
vi.mock('../src/ai/tools/detect-language.tool', () => ({
  runDetectLanguage: vi.fn(async () => ({ language: 'javascript', confidence: 1, status: 'detected' }))
}))

let dir: string
let server: Awaited<ReturnType<typeof createModelServer>> | undefined
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'code2flow-http-'))
})
beforeEach(() => {
  vi.stubEnv('CODE2FLOW_TRACE', 'off')
  vi.stubEnv('CODE2FLOW_MAX_RETRIES', '0')
  vi.stubEnv('CODE2FLOW_CHECKPOINT_DB', join(dir, 'http.sqlite'))
  resetTraceSinkForTesting()
})
afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
  resetTraceSinkForTesting()
  vi.restoreAllMocks()
})
afterAll(async () => {
  getCodeFlowCheckpointer().db.close()
  await rm(dir, { recursive: true, force: true })
})

async function useModel(replies: Parameters<typeof createModelServer>[0]) {
  // 生成工具仅提交图和映射，语言由 Jev 补齐。
  server = await createModelServer(replies.map((reply) => ({
    ...reply,
    args: reply.args ?? { mermaid: result.mermaid, mappings: result.mappings }
  })))
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
  it('keeps one-shot generation and evaluation out of the persistent checkpoint store', async () => {
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

  it('marks a real service failure on an externally supplied collector', async () => {
    const model = await useModel([{ status: 401 }])
    const trace = createTraceCollector({ code, mode: 'generate', maxRetries: 0 })
    await expect(
      generateFlow(
        { code, maxRetries: 0 },
        { trace, model: model.model, checkpointer: new MemorySaver() }
      )
    ).rejects.toThrow()
    const recorded = await trace.finish()
    expect(recorded.outcome).toBe('error')
    expect(recorded.error).toContain('401')
    expect(recorded.usage.llmRounds).toBe(1)
    expect(recorded.usage.reportedRounds).toBe(0)
  })

  it('accumulates provider usage across a real graph retry', async () => {
    const model = await useModel([{ args: { mermaid: 'invalid', mappings: [] } }, {}])
    const trace = createTraceCollector({ code, mode: 'generate' })
    await generateFlow({ code, maxRetries: 1 }, { trace, model: model.model })
    const recorded = await trace.finish()
    expect(recorded.usage).toMatchObject({
      llmRounds: 2, reportedRounds: 2, totalTokens: 60, retryCount: 1
    })
    expect(recorded.responseModels).toEqual(['deepseek-chat'])
  })

  it('writes actual JSONL traces and records usage for both generation and follow-up', async () => {
    await useModel([{}, { text: '记录追问成本。' }])
    const file = join(dir, 'traces.jsonl')
    vi.stubEnv('CODE2FLOW_TRACE', 'on')
    vi.stubEnv('CODE2FLOW_TRACE_FILE', file)
    resetTraceSinkForTesting()
    const app = createApp()
    await request(app).post('/api/generate-flow').send({ code, thread_id: 'traced' }).expect(200)
    await request(app)
      .post('/api/follow-up')
      .send({ thread_id: 'traced', question: '解释' })
      .expect(200)
    const traces = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(traces).toHaveLength(2)
    expect(traces.map((trace) => trace.input.mode)).toEqual(['generate', 'followup'])
    expect(
      traces.every((trace) => trace.outcome === 'success' && trace.usage.totalTokens === 30)
    ).toBe(true)
    expect(traces[1].steps.map((step: { name: string }) => step.name)).toEqual(['explain'])
    const usage = await request(app).get('/api/usage').expect(200)
    expect(usage.body.records).toHaveLength(1)
    expect(usage.body.records[0]).toMatchObject({
      totalTokens: 30,
      completeness: 'complete',
      responseModels: ['deepseek-chat'],
      source: 'online'
    })
  })

  it('leaves the trace file absent when tracing is disabled', async () => {
    await useModel([{}])
    const file = join(dir, 'disabled.jsonl')
    vi.stubEnv('CODE2FLOW_TRACE_FILE', file)
    await request(createApp()).post('/api/generate-flow').send({ code }).expect(200)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
