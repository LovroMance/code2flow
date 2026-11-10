import { MemorySaver } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { analysisTraceConfig, traceStep } from '../src/ai/observability/langsmith'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { generateFlow } from '../src/services/flow-generation.service'
import { MultiFileService } from '../src/services/multifile.service'
import { SessionService } from '../src/services/session.service'
import { sha256 } from '../src/utils/sourcePositions'
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

it('多文件索引使用精简提交，合并草稿和独立生成均可省略节点证据', async () => {
  vi.stubEnv('CODE2FLOW_MULTI_MAX_FILES', '20')
  vi.stubEnv('CODE2FLOW_MULTI_MAX_TOTAL_BYTES', '2097152')
  vi.stubEnv('CODE2FLOW_MULTI_MAX_MODEL_CALLS', '120')
  vi.stubEnv('CODE2FLOW_MULTI_TIMEOUT_MS', '900000')
  vi.stubEnv('CODE2FLOW_MODEL_CONTEXT_TOKENS', '100000')
  vi.stubEnv('CODE2FLOW_MULTI_CONCURRENCY', '1')
  vi.stubEnv('CODE2FLOW_EMBEDDING_MODEL', '')
  const saver = SqliteSaver.fromConnString(':memory:')
  try {
    const sessionId = 'multifile-index'
    new SessionService(saver).ensure(sessionId)
    const service = new MultiFileService(saver)
    const source = `export ${code}`
    const snapshot = await service.createSnapshot(sessionId, [
      { path: 'main.js', content: source },
      { path: 'other.js', content: source }
    ])
    const flowDraft = (fileId: string, unitId: string) => ({
      unitId, entryLocalId: 'set', edges: [],
      nodes: [{
        localId: 'set', kind: 'action', label: '赋值', description: '设置变量',
        range: { fileId, lineStart: 1, lineEnd: 1 }, callSiteIds: []
      }]
    })
    const generationFileId = snapshot.files[1]!.fileId
    const indexReplies = snapshot.files.map(({ fileId }) => {
      const range = { fileId, lineStart: 1, lineEnd: 1 }
      const evidenceIds = [`e${sha256(`${snapshot.snapshotId}|${fileId}|0|${source.length}`).slice(0, 12)}`]
      return {
        toolName: 'submit_file_index',
        args: {
          fileId, summary: '赋值', references: [{ kind: 'export', name: 'answer', range, evidenceIds }],
          unresolvedItems: [],
          units: [{
            unitId: 'unit', name: '入口', kind: 'top-level', range,
            summary: '赋值', controlRanges: [], callSites: [], evidenceIds
          }],
          drafts: fileId === generationFileId ? [] : [flowDraft(fileId, 'unit')]
        }
      }
    })
    const unitKey = JSON.stringify([generationFileId, 0, source.length, '入口', '', 'top-level'])
    const model = await useModel([
      ...indexReplies,
      { toolName: 'submit_unit_flow', args: flowDraft(generationFileId, `u_${sha256(unitKey).slice(0, 10)}`) }
    ])

    const saveFacts = vi.spyOn(service.repo, 'saveFacts')
    const saveCheckpoint = vi.spyOn(saver, 'put')
    const flow = await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})

    expect(saveFacts).toHaveBeenCalledTimes(1)
    const indexes = service.repo.indexes(snapshot)
    expect(indexes).toHaveLength(snapshot.files.length)
    for (const index of indexes) {
      expect(index.units).toMatchObject([{ scope: '', signature: '' }])
      expect(index.references).toMatchObject([{ alias: 'answer', targetPath: '' }])
    }
    const firstResult = saveCheckpoint.mock.calls.findIndex(([, checkpoint]) => checkpoint.channel_values.result)
    expect(firstResult).toBeGreaterThanOrEqual(0)
    expect(saveFacts.mock.invocationCallOrder[0]).toBeLessThan(
      saveCheckpoint.mock.invocationCallOrder[firstResult]!
    )
    expect(flow.hasExecutableFlow).toBe(true)
    expect(flow.coverage.complete).toBe(true)
    expect(new Set(flow.mappings.map((mapping) => mapping.fileId))).toEqual(
      new Set(snapshot.files.map((file) => file.fileId))
    )
    for (const mapping of flow.mappings) {
      const evidenceId = `e${sha256(`${snapshot.snapshotId}|${mapping.fileId}|0|${source.length}`).slice(0, 12)}`
      expect(mapping.evidenceIds).toEqual([evidenceId])
    }
    expect(model.requests).toHaveLength(3)
    for (const request of model.requests) {
      const message = request.messages.find(({ role }) => role === 'user')!
      expect(message.content).not.toMatch(/"(?:complete|byteSize|lineCount|chunkerVersion|strategy|snapshotId)":/)
      expect(JSON.parse(message.content).payload.code.evidence).toMatchObject({
        evidenceId: expect.any(String),
        fileId: expect.any(String),
        lineStart: 1,
        lineEnd: 1
      })
    }
    for (const request of model.requests.slice(0, 2)) {
      expect(request.tools).toMatchObject([{ function: { name: 'submit_file_index' } }])
      expect(JSON.stringify(request.tools)).not.toMatch(
        /read_code|startKnown|endKnown|"boundary"|"complete"|schemaVersion|analyzedRanges/
      )
    }
    expect(model.requests[2]!.tools).toMatchObject([{ function: { name: 'submit_unit_flow' } }])
  } finally {
    saver.db.close()
  }
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
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-chat')
  vi.stubEnv('DEEPSEEK_BASE_URL', server.baseURL)
  return server
}
describe('LangSmith 服务追踪', () => {
  it('保留真实 Agent 和模型的父子关联、输入输出及供应商用量', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'false')
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
