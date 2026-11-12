import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { traceStep } from '../src/ai/observability/langsmith'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { MultiFileService } from '../src/services/multifile.service'
import { SessionService } from '../src/services/session.service'
import { SourceContext } from '../src/services/source-context.service'
import { sha256 } from '../src/utils/sourcePositions'
import { code, createModelServer } from './fixtures/model.fixture'

// 测试用固定语言检测结果，模型请求发往本地夹具。
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

function stubMultiConfig() {
  vi.stubEnv('CODE2FLOW_MULTI_MAX_FILES', '20')
  vi.stubEnv('CODE2FLOW_MULTI_MAX_TOTAL_BYTES', '2097152')
  vi.stubEnv('CODE2FLOW_MULTI_MAX_MODEL_CALLS', '120')
  vi.stubEnv('CODE2FLOW_MULTI_TIMEOUT_MS', '900000')
  vi.stubEnv('CODE2FLOW_MODEL_CONTEXT_TOKENS', '100000')
  vi.stubEnv('CODE2FLOW_MULTI_CONCURRENCY', '1')
  vi.stubEnv('CODE2FLOW_EMBEDDING_MODEL', '')
}

it('多文件提交只返回行号，后端绑定文件、单元及证据', async () => {
  stubMultiConfig()
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
    const range = { lineStart: 1, lineEnd: 1 }
    const flowDraft = {
      entryLocalId: 'set', edges: [],
      nodes: [{
        localId: 'set', kind: 'action', label: '赋值', description: '设置变量',
        range, callSiteIds: []
      }]
    }
    const generationFileId = snapshot.files[1]!.fileId
    const indexReplies = snapshot.files.map(({ fileId }) => {
      return {
        toolName: 'submit_file_index',
        args: {
          summary: '赋值', references: [{ kind: 'export', name: 'answer', range }],
          unresolvedItems: [],
          units: [{
            unitId: 'unit', name: '入口', kind: 'top-level', range,
            summary: '赋值', callSites: []
          }],
          ...(fileId === generationFileId ? {} : { drafts: [{ ...flowDraft, unitId: 'unit' }] })
        }
      }
    })
    const model = await useModel([
      ...indexReplies,
      { toolName: 'submit_unit_flow', args: flowDraft }
    ])

    const saveFacts = vi.spyOn(service.repo, 'saveFacts')
    const saveCheckpoint = vi.spyOn(saver, 'put')
    const events: string[] = []
    const flow = await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, (type, data) => {
      events.push(type === 'metadata' ? String((data as { stage: string }).stage) : type)
    })
    expect(events.indexOf('mappings')).toBeLessThan(events.indexOf('overview'))
    expect(flow.overview?.status).toBe('ready')
    expect((await service.detail(sessionId)).result?.overview).toEqual(flow.overview)

    expect(saveFacts).toHaveBeenCalledTimes(1)
    const indexes = service.repo.indexes(snapshot)
    expect(indexes).toHaveLength(snapshot.files.length)
    for (const index of indexes) {
      const range = { fileId: index.fileId, startOffset: 0, endOffset: source.length }
      const evidenceId = `e${sha256(`${snapshot.snapshotId}|${index.fileId}|0|${source.length}`).slice(0, 12)}`
      expect(index.units).toMatchObject([{ scope: '', signature: '', range, evidenceIds: [evidenceId] }])
      expect(index.references).toMatchObject([{ alias: 'answer', targetPath: '', range, evidenceIds: [evidenceId] }])
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
      expect(mapping.unitId).toBe(indexes.find(({ fileId }) => fileId === mapping.fileId)?.units[0]?.unitId)
    }
    expect(model.requests).toHaveLength(4)
    expect(modelInput(model.requests[3]!).payload.files).toHaveLength(2)
    expect(modelInput(model.requests[3]!).payload).not.toHaveProperty('code')
    for (const request of model.requests.slice(0, 3)) {
      const { payload } = modelInput(request)
      expect(JSON.stringify(payload)).not.toMatch(
        /"(?:complete|byteSize|lineCount|chunkerVersion|strategy|snapshotId|evidenceIds)":/
      )
      expect(payload.code).toEqual({ content: `1| ${source}` })
    }
    for (const request of model.requests.slice(0, 2)) {
      expect(request.tools).toMatchObject([{ function: { name: 'submit_file_index' } }])
      expect(JSON.stringify(request.tools)).not.toMatch(
        /read_code|startKnown|endKnown|"boundary"|"complete"|schemaVersion|analyzedRanges|"(?:fileId|evidenceIds)"/
      )
      expect(JSON.stringify(request.tools)).toContain('"description":"range 内逐字截取')
      expect(JSON.stringify(request.tools)).toContain('"unitId"')
    }
    const generateRequest = model.requests[2]!
    const rules = generateRequest.messages
      .filter(({ role }) => role === 'system')
      .map(({ content }) =>
        typeof content === 'string' ? content : content.map(({ text }) => text).join('\n')
      )
      .join('\n')
    expect(rules).toContain('submit_unit_flow')
    expect(rules).not.toMatch(
      /submit_code_flow_result|Mermaid|mappings|nodeId|columnStart|columnEnd|#quot;/
    )
    expect(generateRequest.tools).toMatchObject([{ function: { name: 'submit_unit_flow' } }])
    expect(JSON.stringify(generateRequest.tools)).not.toMatch(
      /"(?:mermaid|mappings|nodeId|columnStart|columnEnd|fileId|evidenceIds|unitId|start)"/
    )
    expect(JSON.stringify(generateRequest.tools)).toContain('"description":"首个语义节点的 localId')
  } finally {
    saver.db.close()
  }
})

it('模型提交越界行号时索引仍会返修', async () => {
  stubMultiConfig()
  vi.stubEnv('CODE2FLOW_MAX_RETRIES', '1')
  const saver = SqliteSaver.fromConnString(':memory:')
  try {
    const sessionId = 'multifile-invalid-line'
    new SessionService(saver).ensure(sessionId)
    const service = new MultiFileService(saver)
    const snapshot = await service.createSnapshot(sessionId, [{ path: 'main.js', content: code }])
    const model = await useModel([2, 1].map((line) => {
      const range = { lineStart: line, lineEnd: line }
      return {
        toolName: 'submit_file_index',
        args: {
          summary: '赋值', references: [], unresolvedItems: [],
          units: [{
            unitId: 'u1', name: '入口', kind: 'top-level', range,
            summary: '赋值', callSites: []
          }],
          drafts: [{
            unitId: 'u1', entryLocalId: 'entry', edges: [],
            nodes: [{
              localId: 'entry', kind: 'action', label: '赋值', description: '设置变量', range, callSiteIds: []
            }]
          }]
        }
      }
    }))
    const flow = await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})
    expect(model.requests).toHaveLength(3)
    expect(modelInput(model.requests[1]!).validationFeedback).toContain('源码行范围无效')
    expect(flow.mappings).toContainEqual(expect.objectContaining({
      fileId: snapshot.files[0]!.fileId, kind: 'action', startOffset: 0, endOffset: code.length
    }))
  } finally {
    saver.db.close()
  }
})

it.each([
  { targetChars: '256', split: true },
  { targetChars: '6000', split: false }
])('同文件单元可复用调用点临时 ID（切块目标 $targetChars）', async ({ targetChars, split }) => {
  stubMultiConfig()
  vi.stubEnv('CODE2FLOW_MULTI_CHUNK_TARGET_CHARS', targetChars)
  const saver = SqliteSaver.fromConnString(':memory:')
  try {
    const sessionId = 'multifile-chunks'
    new SessionService(saver).ensure(sessionId)
    const service = new MultiFileService(saver)
    const first = `function first() {\n  // ${'a'.repeat(2100)}\n  second()\n}\n`
    const second = 'function second() {\n  first()\n}\n'
    const source = first + second
    const snapshot = await service.createSnapshot(sessionId, [{ path: 'main.js', content: source }])
    const { fileId } = snapshot.files[0]!
    const parts = [
      { name: 'first', target: 'second', start: 0, end: first.length, lineStart: 1, lineEnd: 4, callLine: 3 },
      { name: 'second', target: 'first', start: first.length, end: source.length, lineStart: 5, lineEnd: 7, callLine: 6 }
    ]
    const groups = split ? parts.map((part) => [part]) : [parts]
    const model = await useModel(groups.map((group) => ({
      toolName: 'submit_file_index',
      args: {
        summary: '互相调用', references: [], unresolvedItems: [],
        units: group.map(({ name, target, lineStart, lineEnd, callLine }, index) => ({
          unitId: `u${index + 1}`, name, kind: 'function', range: { lineStart, lineEnd },
          summary: name,
          callSites: [{
            callSiteId: 'c1', kind: 'call', text: `${target}()`, targetHint: target,
            range: { lineStart: callLine, lineEnd: callLine },
            ...(name === 'first' ? { receiver: null } : {})
          }]
        })),
        drafts: group.map(({ name, callLine }, index) => ({
          unitId: `u${index + 1}`, entryLocalId: 'entry', edges: [], emptyReason: null,
          nodes: [{
            localId: 'entry', kind: 'action', label: name, description: name,
            range: { lineStart: callLine, lineEnd: callLine }, callSiteIds: ['c1']
          }]
        }))
      }
    })))
    const read = vi.spyOn(SourceContext.prototype, 'read')
    const flow = await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})

    expect(read.mock.calls).toEqual(
      groups.map((group) => [fileId, group[0]!.start, group[group.length - 1]!.end])
    )
    const calls = service.repo.indexes(snapshot)
      .flatMap(({ units }) => units.flatMap(({ callSites }) => callSites))
    expect(new Set(calls.map(({ callSiteId }) => callSiteId)).size).toBe(2)
    expect(calls.map(({ receiver }) => receiver)).toEqual([undefined, undefined])
    expect(model.requests).toHaveLength(groups.length + 1)
    for (const [index, request] of model.requests.slice(0, groups.length).entries()) {
      expect(request.tools).toMatchObject([{ function: { name: 'submit_file_index' } }])
      const { payload } = modelInput(request)
      const group = groups[index]!
      const { lineStart } = group[0]!
      const { lineEnd } = group[group.length - 1]!
      expect(payload.code.content).toBe(source.split('\n').slice(lineStart - 1, lineEnd)
        .map((line, offset) => `${lineStart + offset}| ${line}`).join('\n'))
      expect(payload).not.toHaveProperty('withDrafts')
    }
    const firstNode = flow.mappings.find(({ label }) => label === 'first')!
    const secondNode = flow.mappings.find(({ label }) => label === 'second')!
    expect(firstNode.unitId).not.toBe(secondNode.unitId)
    expect(flow.mermaid).toContain(`${firstNode.nodeId} -.->|"调用"| ${secondNode.nodeId}`)
    expect(flow.mermaid).toContain(`${secondNode.nodeId} -.->|"调用"| ${firstNode.nodeId}`)

    await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})
    expect(model.requests).toHaveLength(groups.length + 1)
  } finally {
    saver.db.close()
  }
}, 15000)

it.each(['invalid-edge', 'missing-edge', 'missing-node'] as const)('草稿补救只按缺口补读源码 (%s)', async (problem) => {
  stubMultiConfig()
  vi.stubEnv('CODE2FLOW_MAX_RETRIES', '1')
  const saver = SqliteSaver.fromConnString(':memory:')
  try {
    const sessionId = 'multifile-repair'
    new SessionService(saver).ensure(sessionId)
    const service = new MultiFileService(saver)
    const source = [
      'function shipping(region) {',
      '  switch (region) {',
      "    case 'nearby':",
      '      return 600',
      '    default:',
      '      return 1000',
      '  }',
      '}'
    ].join('\n')
    const snapshot = await service.createSnapshot(sessionId, [{ path: 'shipping.js', content: source }])
    const range = (lineStart: number, lineEnd = lineStart) => ({ lineStart, lineEnd })
    const nodes = [
      { localId: 'switch', kind: 'decision', label: '配送地区？', range: range(2) },
      { localId: 'nearby', kind: 'return', label: '返回同城费用', range: range(4) },
      { localId: 'default', kind: 'return', label: '返回默认费用', range: range(6) }
    ].map((node) => ({ ...node, description: node.label, callSiteIds: [] }))
    const edges = [
      { from: 'switch', to: 'nearby', label: '同城' },
      { from: 'switch', to: 'default', label: '默认' }
    ]
    const priorEdges = problem === 'invalid-edge'
      ? [edges[0], { from: 'switch', to: 'missing', label: '默认' }]
      : edges.slice(0, 1)
    const draft = { entryLocalId: 'switch', nodes, edges }
    const model = await useModel([
      {
        toolName: 'submit_file_index',
        args: {
          summary: '计算运费', references: [], unresolvedItems: [],
          units: [{
            unitId: 'u1', name: 'shipping', kind: 'function', range: range(1, 8),
            summary: '计算运费', callSites: []
          }],
          drafts: [{ ...draft, unitId: 'u1', nodes: problem === 'missing-node' ? nodes.slice(0, 2) : nodes, edges: priorEdges }]
        }
      },
      { toolName: 'submit_unit_flow', args: draft }
    ])
    const flow = await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})

    expect(model.requests).toHaveLength(3)
    const { payload, validationFeedback } = modelInput(model.requests[1]!)
    expect(payload.previousDraft.edges).toEqual(priorEdges)
    expect(validationFeedback).toContain(problem === 'invalid-edge' ? '未知节点' : '缺少不同出口')
    expect(payload).not.toHaveProperty('code')
    if (problem !== 'invalid-edge') {
      expect(payload.codeFragments.map(({ content }: { content: string }) => content)).toEqual([
        '2|   switch (region) {'
      ])
    } else expect(payload).not.toHaveProperty('codeFragments')
    expect(flow.mermaid).toContain('-->|"默认"|')
    expect(flow.diagnostics).toEqual([])

    await service.generate(sessionId, snapshot.snapshotId, new AbortController().signal, () => {})
    expect(model.requests).toHaveLength(3)
  } finally {
    saver.db.close()
  }
}, 15000)

function modelInput(request: Awaited<ReturnType<typeof createModelServer>>['requests'][number]) {
  const content = request.messages.find(({ role }) => role === 'user')?.content
  if (typeof content !== 'string') throw new Error('预期用户消息包含 JSON 文本。')
  return JSON.parse(content)
}

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function useModel(replies: Parameters<typeof createModelServer>[0], overviewStatus?: number) {
  server = await createModelServer(replies, (request) => {
    if (overviewStatus) return { status: overviewStatus }
    const { files } = modelInput(request).payload as { files: Array<{ units: Array<{ id: string }> }> }
    return {
      toolName: 'submit_overview',
      args: {
        nodes: [{ id: 'summary', label: '汇总功能', description: '提供主要功能结果', unitIds: files.flatMap(({ units }) => units.map(({ id }) => id)) }],
        edges: []
      }
    }
  })
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-only')
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-chat')
  vi.stubEnv('DEEPSEEK_BASE_URL', server.baseURL)
  return server
}
describe('LangSmith 服务追踪', () => {
  const sessionId = 'visible-session'
  const files = [{ path: 'draft.txt', content: code }]
  const range = { lineStart: 1, lineEnd: 1 }
  const indexReply = {
    toolName: 'submit_file_index',
    args: {
      summary: '赋值', references: [], unresolvedItems: [],
      units: [{
        unitId: 'unit', name: '入口', kind: 'top-level', range,
        summary: '赋值', callSites: []
      }],
      drafts: [{
        unitId: 'unit', entryLocalId: 'set', edges: [],
        nodes: [{
          localId: 'set', kind: 'action', label: '赋值', description: '设置变量',
          range, callSiteIds: []
        }]
      }]
    }
  }
  let saver: SqliteSaver
  let service: MultiFileService
  let sessions: SessionService
  let snapshotId: string

  beforeEach(async () => {
    stubMultiConfig()
    saver = SqliteSaver.fromConnString(':memory:')
    service = new MultiFileService(saver)
    sessions = new SessionService(saver)
    await sessions.create({ id: sessionId })
    snapshotId = (await service.createSnapshot(sessionId, files)).snapshotId
  })
  afterEach(() => saver.db.close())

  function generate() {
    return service.generate(sessionId, snapshotId, new AbortController().signal, () => {})
  }

  it('保留真实 Agent 和模型的父子关联、输入输出及供应商用量', async () => {
    await useModel([indexReply, { text: '代码将 42 赋给 answer。' }])
    const draft = await service.saveDraft(sessionId, { revision: 0, files, activePath: files[0]!.path })
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
    const flow = await traceStep('test-observer', {}, generate, { callbacks: [callback] })
    const root = starts.find((run) => run.name === 'code2flow.multifile')!
    const graph = starts.find((run) => run.name === 'code2flow.multifile-graph')!
    const node = starts.find((run) => run.name === 'indexFile')!
    const task = starts.find((run) => run.name === 'code2flow.analysis-task')!
    const agent = starts.find((run) => run.name === 'code2flow.index-agent')!
    expect(graph.parent).toBe(root.id)
    expect(node.parent).toBe(graph.id)
    expect(task.parent).toBe(node.id)
    expect(agent.parent).toBe(task.id)
    const model = starts.find((run) => run.metadata?.ls_provider === 'deepseek')!
    expect(model.metadata).toMatchObject({
      session_id: sessionId,
      ls_model_name: 'deepseek-chat'
    })
    expect(llmEnd).toHaveBeenCalledTimes(2)
    const message = llmEnd.mock.calls[0][0].generations[0][0].message
    expect(message.usage_metadata).toMatchObject({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30
    })
    expect(flow.mappings).toContainEqual(expect.objectContaining({ lineStart: 1, lineEnd: 1 }))
    await service.followUp(sessionId, snapshotId, '这段代码做什么？', new AbortController().signal)
    expect(await service.detail(sessionId)).toMatchObject({
      draft, result: { snapshotId }, messages: [
        { role: 'user', content: '这段代码做什么？' },
        { role: 'assistant', content: '代码将 42 赋给 answer。' }
      ]
    })
    const blankFiles = [{ path: files[0]!.path, content: '' }]
    const blank = await service.saveDraft(sessionId, { ...draft, files: blankFiles })
    expect(blank.files).toEqual(blankFiles)
    await expect(service.createSnapshot(sessionId, blankFiles)).rejects.toMatchObject({ status: 400 })
    await expect(
      service.followUp(sessionId, snapshotId, '继续解释', new AbortController().signal)
    ).rejects.toMatchObject({ status: 409 })
    await service.saveDraft(sessionId, { revision: blank.revision, files: [], activePath: '' })
    expect(await service.detail(sessionId)).toMatchObject({ snapshot: null, result: null, messages: [] })
    expect(await sessions.get(sessionId)).toMatchObject({ hasDraft: false, hasResult: false })
  })
  it('将真实服务失败传播到请求级追踪', async () => {
    await useModel([{ status: 401 }])
    const errors = vi.fn()
    await expect(
      traceStep(
        'request',
        {},
        generate,
        { callbacks: [BaseCallbackHandler.fromMethods({ handleChainError: errors })] }
      )
    ).rejects.toThrow()
    expect(errors).toHaveBeenCalled()
  })

  it('总体汇总失败后可恢复已经验收的细分图', async () => {
    await useModel([indexReply], 503)
    const flow = await generate()
    expect(flow.overview?.status).toBe('unavailable')
    expect(flow.hasExecutableFlow).toBe(true)
    expect(await service.detail(sessionId)).toMatchObject({ failed: false, result: { mermaid: flow.mermaid, overview: flow.overview } })
  })
  it('accumulates provider usage across a real graph retry', async () => {
    vi.stubEnv('CODE2FLOW_MAX_RETRIES', '1')
    await useModel([{ ...indexReply, args: {} }, indexReply])
    let totalTokens = 0
    const usage = vi.fn((output) => {
      totalTokens += output.generations[0][0].message.usage_metadata.total_tokens
    })
    await traceStep(
      'request',
      {},
      generate,
      {
        callbacks: [BaseCallbackHandler.fromMethods({ handleLLMEnd: usage })]
      }
    )
    expect(usage).toHaveBeenCalledTimes(3)
    expect(totalTokens).toBe(90)
  })
})
