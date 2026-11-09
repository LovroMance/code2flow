import { MemorySaver } from '@langchain/langgraph'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { analysisTraceConfig, traceStep } from '../src/ai/observability/langsmith'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { generateFlow } from '../src/services/flow-generation.service'
import { code, result, createModelServer } from './fixtures/model.fixture'

// 仅验证 LangSmith 服务追踪，语言检测使用固定结果，避免外部调用。
vi.mock('../src/ai/tools/detect-language.tool', () => ({
  runDetectLanguage: vi.fn(async () => ({
    language: 'javascript',
    confidence: 1,
    status: 'detected'
  }))
}))

let server: Awaited<ReturnType<typeof createModelServer>> | undefined
beforeEach(() => {
  vi.stubEnv('LANGSMITH_TRACING', 'false')
  vi.stubEnv('CODE2FLOW_MAX_RETRIES', '0')
})
afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
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
describe('LangSmith 服务追踪', () => {
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
})
