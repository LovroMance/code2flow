import { createServer } from 'node:http'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import {
  chunkSource,
  lineOffsets,
  missingRanges,
  normalizeSourcePath,
  sourceRange,
  validateSourceRange,
  validateChunks
} from '../src/utils/sourcePositions'
import { SourceRangeSchema } from '../src/domain/source/schema'
import { SessionService } from '../src/services/session.service'
import { MultiFileService } from '../src/services/multifile.service'
import { SourceContext } from '../src/services/source-context.service'
import { RetrievalService, cosine, rrf } from '../src/services/retrieval.service'
import { runDetectLanguage } from '../src/ai/tools/detect-language.tool'
import { createMultiFileRouter } from '../src/routes/multifile.route'
import { mergeTaskOutcomes } from '../src/ai/graph/multifile.graph'
import {
  AnalysisBudget,
  AnalysisLimitError,
  runMultiFileChain
} from '../src/ai/chains/multifile.chain'
import { modelOutputTokens } from '../src/services/multifile-config'
import { escapeMermaidLabel } from '../src/utils/composeMultiFileFlow'
import { FileSemanticIndexSchema, type FileSemanticIndex } from '../src/domain/multifile/schema'
import {
  referenceCandidates,
  validateResolvedReference
} from '../src/services/reference-resolution.service'
import { resetTraceSinkForTesting } from '../src/ai/observability/trace.sink'

vi.mock('../src/ai/tools/detect-language.tool', () => ({
  runDetectLanguage: vi.fn(async () => ({
    language: 'unknown',
    confidence: 0,
    status: 'uncertain'
  }))
}))
const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
async function setup() {
  vi.stubEnv('CODE2FLOW_TRACE', 'off')
  resetTraceSinkForTesting()
  const saver = SqliteSaver.fromConnString(':memory:')
  cleanup.push(() => saver.db.close())
  const sessions = new SessionService(saver)
  await sessions.create({ id: 's' })
  await sessions.create({ id: 'other' })
  const service = new MultiFileService(saver)
  return { saver, sessions, service, repo: service.repo }
}
async function modelServer(
  options: {
    invalidOnce?: boolean
    invalidSchemaOnce?: boolean
    invalidCallOnce?: boolean
    invalidFlowOnce?: boolean
    empty?: boolean
    cycle?: boolean
    fragments?: boolean
    unclosed?: boolean
    truncated?: boolean
    unauthorized?: boolean
    outputLimits?: number[]
  } = {}
) {
  const calls: string[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw),
      name = body.tools
        .map((t: { function: { name: string } }) => t.function.name)
        .find((n: string) => n.startsWith('submit_'))
    const input = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === 'user').content
      ),
      payload = input.payload
    calls.push(name ?? 'followup')
    options.outputLimits?.push(body.max_tokens)
    if (options.unauthorized) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ error: { message: 'fixture unauthorized', type: 'authentication_error' } })
      )
      return
    }
    let args: unknown
    if (name === 'submit_file_index') {
      const range = SourceRangeSchema.parse(payload.code.evidence),
        id = payload.file.fileId,
        b = payload.file.path === 'b.ts',
        target = options.cycle && b ? 'a' : 'b',
        // 夹具也必须遵守调用证据契约，不能在不含调用的源码中虚构调用点。
        isCaller =
          (payload.file.path === 'a.ts' || (options.cycle && b)) &&
          String(payload.code.content).includes(`${target}()`)
      const evidenceIds = [payload.code.evidence.evidenceId]
      const boundary = {
        startKnown: !options.fragments || range.startOffset === 0,
        endKnown:
          !options.fragments || (!options.unclosed && range.endOffset === payload.file.byteSize)
      }
      args = {
        fileId: id,
        summary: '文件职责',
        schemaVersion: '2',
        status: options.fragments ? 'partial' : 'complete',
        analyzedRanges: [{ startOffset: range.startOffset, endOffset: range.endOffset }],
        unresolvedItems: options.fragments
          ? [
              {
                description: '单元跨块待合并',
                kind: 'boundary',
                unitId: 'temp',
                blocking: true,
                range
              }
            ]
          : [],
        units: [
          {
            unitId: 'temp',
            name: b ? 'b' : options.cycle ? 'a' : 'main',
            scope: '',
            kind: options.empty ? 'declaration' : b || options.cycle ? 'function' : 'top-level',
            range,
            signature: '',
            summary: '执行单元',
            controlRanges: [],
            callSites: isCaller
              ? [
                  {
                    callSiteId: 'temp_call',
                    kind: 'call',
                    text: `${target}()`,
                    range,
                    targetHint: target,
                    evidenceIds
                  }
                ]
              : [],
            evidenceIds,
            complete: boundary.startKnown && boundary.endKnown,
            boundary
          }
        ],
        references: isCaller
          ? [
              {
                kind: 'import',
                name: target,
                alias: target,
                targetPath: `./${target}.ts`,
                range,
                evidenceIds
              }
            ]
          : []
      }
      if (options.invalidOnce && calls.length === 1)
        (args as { analyzedRanges: unknown[] }).analyzedRanges = []
      if (options.invalidSchemaOnce && calls.length === 1)
        (args as { schemaVersion: unknown }).schemaVersion = 2
      if (options.invalidCallOnce && calls.length === 1)
        (
          args as { units: Array<{ callSites: Array<{ text: string }> }> }
        ).units[0]!.callSites[0]!.text = '调用函数的释义'
    } else if (name === 'submit_unit_flow') {
      const unit = payload.unit,
        range = SourceRangeSchema.parse(payload.code.evidence)
      args = {
        unitId: unit.unitId,
        nodes: options.empty
          ? []
          : [
              {
                localId: 'a',
                kind: 'action',
                label: '执行职责',
                description: '执行上传源码',
                range,
                evidenceIds: [payload.code.evidence.evidenceId],
                callSiteIds: unit.callSites.map((c: { callSiteId: string }) => c.callSiteId)
              }
            ],
        edges:
          options.invalidFlowOnce &&
          calls.filter((name) => name === 'submit_unit_flow').length === 1
            ? [{ from: 'missing', to: 'a', label: '' }]
            : [],
        entryLocalId: options.empty ? null : 'a',
        emptyReason: options.empty ? '仅声明' : ''
      }
    } else if (name === 'submit_reference_verification') args = { references: [] }
    // 模拟模型按新提交协议只返回行列；analyzedRanges仍保留实际读取偏移。
    const modelArgs = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(modelArgs)
      if (!value || typeof value !== 'object') return value
      const record = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, modelArgs(item)])
      )
      if ('fileId' in record && 'lineStart' in record && 'columnEnd' in record) {
        delete record.startOffset
        delete record.endOffset
      }
      return record
    }
    args = options.truncated ? { fileId: payload.file.fileId, units: [] } : modelArgs(args)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = name
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_${calls.length}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) }
            }
          ]
        }
      : { role: 'assistant', content: '根据当前快照解释。' }
    const send = (delta: unknown, finish_reason: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: `r${calls.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], usage: finish_reason ? { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } : undefined })}\n\n`
      )
    send(delta, null)
    send({}, options.truncated ? 'length' : name ? 'tool_calls' : 'stop')
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('夹具启动失败')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  )
  vi.stubEnv('DEEPSEEK_BASE_URL', `http://127.0.0.1:${address.port}/v1`)
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture')
  vi.stubEnv('CODE2FLOW_MODEL_CONTEXT_TOKENS', '128000')
  vi.stubEnv('CODE2FLOW_MULTI_MAX_OUTPUT_TOKENS', '200000')
  vi.stubEnv('CODE2FLOW_EMBEDDING_MODEL', '')
  return calls
}
describe('多文件原始位置与上传边界', () => {
  it('可配置分块完整保留原文，缓存缺块直接抛错而不重建', async () => {
    const content = '\uFEFF中文😀\r\n' + '  step();\r\n'.repeat(25) + '尾部😀'
    const chunks = chunkSource('f', content, 256, 4)
    let cursor = 0
    const restored = chunks
      .map((chunk) => {
        const part = content.slice(cursor, chunk.endOffset)
        cursor = chunk.endOffset
        return part
      })
      .join('')
    expect(restored).toBe(content)
    expect(chunks.every((chunk) => chunk.endOffset - chunk.startOffset <= 256)).toBe(true)
    expect(() => validateChunks('f', content, chunks.slice(1))).toThrow('分块实现错误')
    const { service, repo } = await setup()
    const snapshot = await service.createSnapshot('s', [{ path: 'a.js', content }])
    repo.basicChunks(snapshot, 256, 4)
    repo.db.prepare('UPDATE code_flow_chunk_templates SET data = ?').run('[]')
    expect(() => repo.basicChunks(snapshot, 256, 4)).toThrow('没有完整覆盖')
  })
  it('读取坐标提示保留CRLF和UTF-16，范围冲突仍拒绝且提供数字反馈', async () => {
    const { service, repo } = await setup()
    const content = '中文😀\r\n  return true\r\n'
    const snapshot = await service.createSnapshot('s', [{ path: 'a.js', content }])
    const fileId = snapshot.files[0]!.fileId
    const context = new SourceContext(repo, snapshot, [])
    const read = context.read(fileId, 0, content.length)
    expect(read.linePositions).toEqual([
      { line: 1, startOffset: 0, endOffset: 4, columnStart: 1, columnEnd: 5 },
      { line: 2, startOffset: 6, endOffset: 19, columnStart: 1, columnEnd: 14 }
    ])
    const range = sourceRange(fileId, content, 6, 19)
    expect(() => context.validate({ ...range, columnEnd: 13 }, [read.evidence.evidenceId])).toThrow(
      '偏移实际对应2:1-2:14'
    )
    expect(() => context.validate(range, [read.evidence.evidenceId])).not.toThrow()
  })
  it('保留BOM/CRLF/中文/emoji，长行不切代理对且覆盖完整正文', () => {
    const code = '\uFEFF中文😀\r\n' + '😀a'.repeat(8000) + '\n结束'
    expect(lineOffsets(code)[1]).toBe(7)
    const chunks = chunkSource('f', code)
    expect(chunks.length).toBeGreaterThan(3)
    expect(missingRanges(code.length, chunks)).toEqual([])
    for (const chunk of chunks) {
      expect(chunk.endOffset - chunk.startOffset).toBeLessThanOrEqual(8000)
      validateSourceRange(chunk, 'f', code)
    }
    const range = sourceRange('f', code, 7, 10)
    expect(range.columnStart).toBe(1)
    expect(range.columnEnd).toBe(4)
    expect(() => validateSourceRange({ ...range, lineStart: 999 }, 'f', code)).toThrow()
  })
  it('拒绝越界、重复路径、空文件、二进制和超限；manifest受改名影响', async () => {
    const { service } = await setup()
    for (const path of ['../a.py', '/a.py', 'C:\\a.py', 'a/../../a.py', 'a\0.py'])
      expect(() => normalizeSourcePath(path)).toThrow()
    expect(normalizeSourcePath('src\\a.py')).toBe('src/a.py')
    for (const files of [
      [{ path: 'a.py', content: '' }],
      [{ path: 'a.py', content: '\0' }],
      [{ path: 'a.py', content: 'x'.repeat(204801) }],
      [
        { path: 'a.py', content: 'x' },
        { path: './a.py', content: 'y' }
      ]
    ])
      await expect(service.createSnapshot('s', files)).rejects.toThrow()
    const a = await service.createSnapshot('s', [{ path: 'a.py', content: '\uFEFFx\r\n' }]),
      same = await service.createSnapshot('s', [{ path: 'a.py', content: '\uFEFFx\r\n' }]),
      renamed = await service.createSnapshot('s', [{ path: 'b.py', content: '\uFEFFx\r\n' }])
    expect(a.snapshotId).toBe(same.snapshotId)
    expect(a.manifestHash).not.toBe(renamed.manifestHash)
    const originalChunks = service.repo.basicChunks(a),
      reboundChunks = service.repo.basicChunks(renamed)
    expect(originalChunks[0]!.fileId).not.toBe(reboundChunks[0]!.fileId)
    expect(originalChunks[0]!.startOffset).toBe(reboundChunks[0]!.startOffset)
    expect(
      service.repo.db.prepare('SELECT COUNT(*) n FROM code_flow_chunk_templates').get()
    ).toEqual({ n: 1 })
    service.repo.saveChunks(a, originalChunks)
    expect(service.repo.chunks(a)).toEqual(originalChunks)
    expect(() => service.file('other', a.snapshotId, a.files[0]!.fileId)).toThrow()
    expect(service.file('s', a.snapshotId, a.files[0]!.fileId).content).toBe('\uFEFFx\r\n')
  })
})
describe('工具、检索与草稿一致性', () => {
  it('清空草稿经接口持久化为空集合，保留版本校验并拒绝空快照', async () => {
    const { service, saver } = await setup()
    const app = express()
    app.use(
      '/api/v2',
      createMultiFileRouter(() => service)
    )
    await service.saveDraft('s', {
      revision: 0,
      files: [{ path: 'a.js', content: 'run()' }],
      activePath: 'a.js'
    })
    const empty = { revision: 1, files: [], activePath: '' }
    await request(app).patch('/api/v2/sessions/s/draft').send(empty).expect(200)
    expect((await new MultiFileService(saver).detail('s')).draft).toEqual({ ...empty, revision: 2 })
    await request(app).patch('/api/v2/sessions/s/draft').send(empty).expect(409)
    await request(app)
      .patch('/api/v2/sessions/s/draft')
      .send({ ...empty, revision: 2, activePath: 'a.js' })
      .expect(400)
    await request(app).post('/api/v2/sessions/s/snapshots').send({ files: [] }).expect(400)
  })
  it('导入别名定位唯一同名实现；缺少绑定时不按函数同名误连', async () => {
    const { service, repo } = await setup(),
      snapshot = await service.createSnapshot('s', [
        {
          path: 'main.ts',
          content: "import { load as work } from './worker'; function start(){ work(); load() }"
        },
        { path: 'worker.ts', content: 'export function load() {}' },
        { path: 'shadow.ts', content: 'export function load() {}' }
      ]),
      indexes: FileSemanticIndex[] = [],
      context = new SourceContext(repo, snapshot, [], indexes)
    snapshot.files.forEach((file, index) => {
      const read = context.read(file.fileId, 0, repo.content(snapshot, file.fileId).length),
        range = SourceRangeSchema.parse(read.evidence),
        evidenceIds = [read.evidence.evidenceId],
        source = file.path === 'main.ts'
      indexes.push(
        FileSemanticIndexSchema.parse({
          fileId: file.fileId,
          summary: '职责',
          schemaVersion: '2',
          status: 'complete',
          analyzedRanges: [range],
          unresolvedItems: [],
          references: source
            ? [
                {
                  kind: 'import',
                  name: 'load',
                  alias: 'work',
                  targetPath: './worker',
                  range,
                  evidenceIds
                }
              ]
            : [],
          units: [
            {
              unitId: `u${index}`,
              name: source ? 'start' : 'load',
              scope: '',
              kind: 'function',
              signature: '',
              summary: '职责',
              range,
              evidenceIds,
              complete: true,
              boundary: { startKnown: true, endKnown: true },
              controlRanges: [],
              callSites: source
                ? [
                    {
                      callSiteId: 'call',
                      kind: 'call',
                      text: 'work()',
                      targetHint: 'work',
                      range,
                      evidenceIds
                    }
                  ]
                : []
            }
          ]
        })
      )
    })
    const candidate = referenceCandidates(snapshot, indexes)[0]!
    expect(candidate.candidates).toHaveLength(1)
    expect(
      snapshot.files.find((file) => file.fileId === candidate.candidates[0]!.range.fileId)!.path
    ).toBe('worker.ts')
    validateResolvedReference(
      {
        referenceId: 'r',
        sourceUnitId: candidate.unit.unitId,
        callSiteId: 'call',
        targetUnitId: candidate.candidates[0]!.unitId,
        targetHint: 'work',
        kind: 'call',
        status: 'resolved',
        evidenceIds: [...context.evidence.keys()],
        diagnostic: ''
      },
      context,
      indexes.flatMap((index) => index.units)
    )
    const source = indexes.find((index) => index.units[0]!.name === 'start')!
    source.references = []
    source.units[0]!.callSites[0]!.targetHint = 'load'
    source.units[0]!.callSites[0]!.text = 'load()'
    expect(referenceCandidates(snapshot, indexes)[0]!.candidates).toEqual([])
  })
  it('无语义索引仍可检索；读取截断返回实际证据和继续范围', async () => {
    const { service, repo } = await setup(),
      snapshot = await service.createSnapshot('s', [
        { path: 'src/a.py', content: 'identifier = 1\n'.repeat(900) }
      ]),
      file = snapshot.files[0]!,
      chunks = chunkSource(file.fileId, repo.content(snapshot, file.fileId))
    repo.saveChunks(snapshot, chunks)
    const retrieval = new RetrievalService(repo, snapshot, chunks, new AbortController().signal)
    await retrieval.prepare()
    expect((await retrieval.search('identifier', 'hybrid')).data.length).toBeGreaterThan(0)
    expect(retrieval.diagnostics.map((d) => d.code)).toContain('embedding_unconfigured')
    const context = new SourceContext(repo, snapshot, chunks, [], undefined, retrieval),
      tools = context.tools()
    const read = await tools
      .find((t) => t.name === 'read_code')!
      .invoke({
        selectors: [
          {
            type: 'range',
            fileId: file.fileId,
            range: { lineStart: 1, lineEnd: 900, columnStart: 1, columnEnd: 15 }
          }
        ]
      })
    expect(read.truncated).toBe(true)
    expect(read.data[0].nextRange).toBeDefined()
    expect(read.metering.chars).toBeLessThanOrEqual(12000)
    await expect(
      tools
        .find((t) => t.name === 'read_code')!
        .invoke({ selectors: [{ type: 'chunk', chunkId: 'other' }] })
    ).rejects.toThrow()
    const draft = { revision: 0, files: [{ path: 'a.py', content: 'x' }], activePath: 'a.py' }
    expect((await service.saveDraft('s', draft)).revision).toBe(1)
    await expect(service.saveDraft('s', draft)).rejects.toThrow('版本')
  })
  it('余弦维度严格检查，RRF按排名融合，reducer保留不同任务', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(() => cosine([1], [1, 2])).toThrow()
    expect(() => cosine([NaN], [1])).toThrow()
    expect(
      rrf([
        ['a', 'b'],
        ['b', 'c']
      ])[0]
    ).toBe('b')
    const outcome = (taskId: string) => ({ taskId, attempts: 1, error: null, fatal: false })
    expect(Object.keys(mergeTaskOutcomes({ a: outcome('a') }, { b: outcome('b') }))).toEqual([
      'a',
      'b'
    ])
    expect(escapeMermaidLabel('a"<script>')).not.toContain('<script>')
  })
  it('独立Embedding批量适配、Float32缓存和维度变化降级', async () => {
    let count = 0,
      dimension = 2
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const part of req) raw += part
      const body = JSON.parse(raw),
        input = Array.isArray(body.input) ? body.input : [body.input]
      count++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          data: input.map((_: unknown, index: number) => ({
            object: 'embedding',
            index,
            embedding: dimension === 2 ? [1, 0] : [1, 0, 0]
          })),
          model: 'fixture-embedding',
          usage: { prompt_tokens: 5, total_tokens: 5 }
        })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('向量夹具无地址')
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
    )
    vi.stubEnv('CODE2FLOW_EMBEDDING_BASE_URL', `http://127.0.0.1:${address.port}/v1`)
    vi.stubEnv('CODE2FLOW_EMBEDDING_API_KEY', 'fixture')
    vi.stubEnv('CODE2FLOW_EMBEDDING_MODEL', 'fixture-embedding')
    const { service, repo } = await setup(),
      snapshot = await service.createSnapshot('s', [{ path: 'a.py', content: 'process_order()' }]),
      file = snapshot.files[0]!,
      chunks = chunkSource(file.fileId, 'process_order()')
    repo.saveChunks(snapshot, chunks)
    const retrieval = new RetrievalService(repo, snapshot, chunks, new AbortController().signal)
    await retrieval.prepare()
    expect(retrieval.vectors.size).toBe(1)
    expect(count).toBe(1)
    expect(retrieval.embeddingUsage.inputTokens).toBe(5)
    const cached = new RetrievalService(repo, snapshot, chunks, new AbortController().signal)
    await cached.prepare()
    expect(count).toBe(1)
    expect((await cached.search('处理订单', 'semantic')).data[0]!.sources).toContain('semantic')
    dimension = 3
    const changed = await cached.search('处理订单', 'semantic')
    expect(changed.diagnostics.some((d) => d.code === 'embedding_query_failed')).toBe(true)
    const overflow = new RetrievalService(
      repo,
      snapshot,
      Array.from({ length: 2001 }, () => chunks[0]!),
      new AbortController().signal
    )
    await overflow.prepare()
    expect(overflow.diagnostics.some((d) => d.code === 'vector_limit')).toBe(true)
  })
})
describe('v2真实LangChain、StateGraph、SQLite、HTTP集成', () => {
  it('输出截断优先于残缺字段错误，不重试、不提交done，输出预算与请求配置一致', async () => {
    const outputLimits: number[] = []
    const calls = await modelServer({ truncated: true, outputLimits })
    vi.stubEnv('CODE2FLOW_MODEL_MAX_OUTPUT_TOKENS', '8192')
    const { service } = await setup()
    const snapshot = await service.createSnapshot('s', [{ path: 'a.ts', content: 'b()' }])
    const app = express()
    app.use(
      '/api/v2',
      createMultiFileRouter(() => service)
    )
    const response = await request(app)
      .post('/api/v2/generate-flow')
      .send({ thread_id: 's', snapshotId: snapshot.snapshotId })
    expect(response.text).toContain('8192 token 上限')
    expect(response.text).toContain('截断')
    expect(response.text).not.toContain('"type":"done"')
    expect(calls).toHaveLength(1)
    expect(outputLimits).toEqual([8192])
    expect(modelOutputTokens()).toBe(8192)
    const budget = new AnalysisBudget(new AbortController().signal)
    expect(budget.reserve('index', 10).output).toBe(8192)
    expect((await service.detail('s')).result).toBeNull()
  })
  it('鉴权失败穿透中间件包装，不重复请求模型', async () => {
    const calls = await modelServer({ unauthorized: true })
    const { service } = await setup()
    const snapshot = await service.createSnapshot('s', [{ path: 'a.ts', content: 'b()' }])
    await expect(
      service.generate('s', snapshot.snapshotId, new AbortController().signal, () => {})
    ).rejects.toThrow('鉴权或模型配置错误')
    expect(calls).toHaveLength(1)
  })
  it('程序错误和被中间件包装的预算错误直接终止，保留原始异常', async () => {
    const calls = await modelServer()
    const { service, repo } = await setup()
    const snapshot = await service.createSnapshot('s', [{ path: 'a.ts', content: 'b()' }])
    const fault = new TypeError('fixture programming error')
    const cache = vi.spyOn(repo, 'cacheGet').mockImplementation(() => {
      throw fault
    })
    try {
      await expect(
        service.generate('s', snapshot.snapshotId, new AbortController().signal, () => {})
      ).rejects.toBe(fault)
    } finally {
      cache.mockRestore()
    }
    const limit = new AnalysisLimitError('分析预算测试上限。')
    const reserve = vi.spyOn(AnalysisBudget.prototype, 'reserve').mockImplementation(() => {
      throw limit
    })
    try {
      await expect(
        service.generate('s', snapshot.snapshotId, new AbortController().signal, () => {})
      ).rejects.toBe(limit)
    } finally {
      reserve.mockRestore()
    }
    expect(calls).toHaveLength(0)
  })
  it('索引阶段就拒绝改写的调用文本，并由原索引任务重试修复', async () => {
    const calls = await modelServer({ invalidCallOnce: true, empty: true })
    const { service } = await setup()
    const snapshot = await service.createSnapshot('s', [{ path: 'a.ts', content: 'b()' }])
    const result = await service.generate(
      's',
      snapshot.snapshotId,
      new AbortController().signal,
      () => {}
    )
    expect(result.snapshotId).toBe(snapshot.snapshotId)
    expect(calls.filter((name) => name === 'submit_file_index')).toHaveLength(2)
  })
  it('结构化提交不符合schema时给graph字段级反馈，下一次尝试可成功', async () => {
    const calls = await modelServer({ invalidSchemaOnce: true, empty: true })
    const { service } = await setup()
    const snapshot = await service.createSnapshot('s', [
      { path: 'a.ts', content: 'export const x = 1' }
    ])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const result = await service.generate(
        's',
        snapshot.snapshotId,
        new AbortController().signal,
        () => {}
      )
      expect(result.snapshotId).toBe(snapshot.snapshotId)
      expect(calls.filter((name) => name === 'submit_file_index')).toHaveLength(2)
      const failure = log.mock.calls.find(([event]) => event === '[code-flow][v2] task-failed')?.[1]
      expect(failure).toMatchObject({ diagnostic: expect.stringContaining('schemaVersion') })
      expect(log.mock.calls.some(([event]) => event === '[code-flow][v2] submission-invalid')).toBe(
        true
      )
    } finally {
      log.mockRestore()
    }
  })
  it('跨块片段在原始重叠范围上合并，不能确认结束边界时补读重试后仍不done', async () => {
    const calls = await modelServer({ fragments: true }),
      { service } = await setup(),
      content = `function main() {\n${'  step();\n'.repeat(240)}}\n`,
      snapshot = await service.createSnapshot('s', [{ path: 'long.ts', content }])
    const result = await service.generate(
      's',
      snapshot.snapshotId,
      new AbortController().signal,
      () => {}
    )
    expect(calls.filter((name) => name === 'submit_file_index').length).toBeGreaterThan(1)
    expect(calls.filter((name) => name === 'submit_unit_flow')).toHaveLength(1)
    expect(result.mappings).toHaveLength(1)
    expect(result.mappings[0]!.startOffset).toBe(0)
    expect(result.mappings[0]!.endOffset).toBe(content.length)
    expect(result.coverage.complete).toBe(true)
    expect(result.coverage.unresolvedRanges).toEqual([])
    await modelServer({ fragments: true, unclosed: true })
    const missing = await service.createSnapshot('s', [
        { path: 'incomplete.ts', content: content.slice(0, -2) }
      ]),
      events: string[] = []
    await expect(
      service.generate('s', missing.snapshotId, new AbortController().signal, (type) =>
        events.push(type)
      )
    ).rejects.toThrow('源码覆盖未完成')
    expect(events).not.toContain('done')
    expect((await service.detail('s')).result).toBeNull()
  }, 30000)
  it('文件索引结构化输出协议', async () => {
    await modelServer()
    const { service, repo } = await setup(),
      snapshot = await service.createSnapshot('s', [{ path: 'a.py', content: 'b()' }]),
      file = snapshot.files[0]!,
      chunks = chunkSource(file.fileId, 'b()'),
      signal = new AbortController().signal,
      context = new SourceContext(repo, snapshot, chunks, [], signal)
    const result = await runMultiFileChain(
      'index',
      { file, code: context.read(file.fileId, 0, 3) },
      context,
      'unknown',
      new AnalysisBudget(signal)
    )
    expect(result.status).toBe('complete')
  }, 30000)
  it('全文件覆盖、跨文件调用、独立流程、缓存、单次检测、追问及删除', async () => {
    const calls = await modelServer(),
      { service, sessions, saver } = await setup()
    const snapshot = await service.createSnapshot('s', [
      { path: 'a.ts', content: "import { b } from './b.ts';\nb()" },
      { path: 'b.ts', content: 'function b() { return 1 }' },
      { path: 'independent.ts', content: 'console.log(1)' }
    ])
    const events: Array<{ type: string; content: unknown }> = [],
      emit = (type: string, content?: unknown) => events.push({ type, content })
    const result = await service.generate(
      's',
      snapshot.snapshotId,
      new AbortController().signal,
      emit
    )
    expect(result.version).toBe(2)
    expect(result.coverage.complete).toBe(true)
    expect(result.coverage.files).toHaveLength(3)
    expect(result.mappings).toHaveLength(3)
    expect(result.detectedLanguage).toBe('unknown')
    expect(result.mermaid).toContain('-.->|"调用"|')
    expect(result.mermaid.match(/subgraph/g)).toHaveLength(3)
    expect(events.slice(-4).map((e) => e.type)).toEqual(['metadata', 'mermaid', 'mappings', 'done'])
    const before = calls.length
    const again = await service.generate(
      's',
      snapshot.snapshotId,
      new AbortController().signal,
      emit
    )
    expect(again.analysisId).not.toBe(result.analysisId)
    expect(vi.mocked(runDetectLanguage)).toHaveBeenCalledTimes(1)
    expect(calls.slice(before).filter((n) => n === 'submit_file_index')).toHaveLength(0)
    expect(calls.slice(before)).toHaveLength(0)
    expect((await service.detail('s')).result?.analysisId).toBe(again.analysisId)
    expect(
      (await service.followUp('s', snapshot.snapshotId, '为什么？', new AbortController().signal))
        .explanation
    ).toContain('当前快照')
    expect(vi.mocked(runDetectLanguage)).toHaveBeenCalledTimes(1)
    expect((await sessions.list()).map((s) => s.id)).not.toContain('v2:s')
    await sessions.delete('s')
    expect(saver.db.prepare('SELECT count(*) n FROM code_flow_source_blobs').get()).toEqual({
      n: 0
    })
    expect((await sessions.list()).map((s) => s.id)).not.toContain('s')
  }, 30000)
  it('相互调用只生成每个单元一次，没有自动返回边；缺失目录线索保留边界', async () => {
    const calls = await modelServer({ cycle: true }),
      { service } = await setup(),
      snapshot = await service.createSnapshot('s', [
        { path: 'a.ts', content: "import { b } from './b.ts'; function a(){ b() }" },
        { path: 'b.ts', content: "import { a } from './a.ts'; function b(){ a() }" }
      ])
    const result = await service.generate(
      's',
      snapshot.snapshotId,
      new AbortController().signal,
      () => {}
    )
    expect(calls.filter((c) => c === 'submit_unit_flow')).toHaveLength(2)
    expect(result.mappings).toHaveLength(2)
    expect(result.mermaid.match(/-.->/g)).toHaveLength(2)
    expect(result.mermaid).not.toContain(' --> ')
    const renamed = await service.createSnapshot('s', [
      { path: 'a.ts', content: "import { b } from './src/b.ts'; b()" },
      { path: 'b.ts', content: 'function b(){ return 1 }' }
    ])
    const boundary = await service.generate(
      's',
      renamed.snapshotId,
      new AbortController().signal,
      () => {}
    )
    expect(boundary.mermaid).not.toContain('-.->')
    expect(boundary.diagnostics.some((d) => d.code === 'unresolved_reference')).toBe(true)
  }, 30000)
  it('文件校验失败仅重试失败任务；声明空态与16MiB路由保持兼容', async () => {
    const calls = await modelServer({ invalidOnce: true, invalidFlowOnce: true, empty: true }),
      { service } = await setup()
    const app = express()
    app.use(
      '/api/v2',
      createMultiFileRouter(() => service)
    )
    const uploaded = await request(app)
      .post('/api/v2/sessions/s/snapshots')
      .send({ files: [{ path: 'a.py', content: 'x: int' }] })
      .expect(201)
    const response = await request(app)
      .post('/api/v2/generate-flow')
      .send({ thread_id: 's', snapshotId: uploaded.body.snapshotId })
      .expect(200)
    expect(response.text).toContain('"type":"done"')
    expect(calls.filter((n) => n === 'submit_file_index')).toHaveLength(2)
    const detail = await service.detail('s')
    expect(detail.result?.hasExecutableFlow).toBe(false)
    expect(detail.result?.mappings).toEqual([])
    expect(detail.result?.mermaid).toBe('')
    await request(app)
      .get(`/api/v2/sessions/other/snapshots/${uploaded.body.snapshotId}`)
      .expect(404)
  }, 30000)
  it('预算和取消不会提交部分done', async () => {
    await modelServer()
    const { service } = await setup(),
      snapshot = await service.createSnapshot('s', [{ path: 'a.py', content: 'print(1)' }])
    vi.stubEnv('CODE2FLOW_MULTI_MAX_MODEL_CALLS', '1')
    const events: string[] = []
    await expect(
      service.generate('s', snapshot.snapshotId, new AbortController().signal, (type) =>
        events.push(type)
      )
    ).rejects.toThrow()
    expect(events).not.toContain('done')
    expect((await service.detail('s')).result).toBeNull()
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.generate('s', snapshot.snapshotId, controller.signal, () => {})
    ).rejects.toThrow()
    const budget = new AnalysisBudget(controller.signal)
    expect(() => budget.reserve('generate', 10)).toThrow()
  }, 30000)
})
