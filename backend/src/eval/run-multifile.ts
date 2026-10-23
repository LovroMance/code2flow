import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { createAgent, modelCallLimitMiddleware, toolStrategy } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { SourceFilesSchema, type SourceSnapshot } from '../domain/source/schema'
import {
  FileSemanticIndexSchema,
  CrossFileReferenceSchema,
  UnitFlowDraftSchema,
  type MultiFileFlowResult
} from '../domain/multifile/schema'
import { NodeKindSchema } from '../domain/flow/schema'
import { SessionService } from '../services/session.service'
import { MultiFileService } from '../services/multifile.service'
import { SourceContext } from '../services/source-context.service'
import { AnalysisBudget } from '../ai/chains/multifile.chain'
import { createOpenAIModel } from '../ai/llms/openai'
import { CODE_FLOW_PROMPT_RULES } from '../prompts/code-flow.prompt'
import { buildLanguageSpecificSystemPrompt } from '../ai/prompts/code-flow-language.system.prompt'
import { composeMultiFileFlow } from '../utils/composeMultiFileFlow'
import { chunkSource, missingRanges } from '../utils/sourcePositions'
import { validateResolvedReference } from '../services/reference-resolution.service'

const CaseSchema = z.object({
  name: z.string(),
  files: SourceFilesSchema,
  controls: z.array(
    z.object({ path: z.string(), line: z.number().int().positive(), kind: NodeKindSchema })
  ),
  calls: z.array(z.object({ fromPath: z.string(), toPath: z.string() }))
})
const DirectSchema = z.object({
  indexes: z.array(FileSemanticIndexSchema),
  flows: z.array(UnitFlowDraftSchema),
  references: z.array(CrossFileReferenceSchema)
})

// 仅用于离线成本对照，不接入产品路由；直接提供全部原文，不能作为超限时的隐式降级。
async function directBaseline(
  service: MultiFileService,
  snapshot: SourceSnapshot,
  signal: AbortSignal
) {
  const language = snapshot.languageDetection!.language,
    budget = new AnalysisBudget(signal),
    indexes: z.infer<typeof FileSemanticIndexSchema>[] = []
  const chunks = snapshot.files.flatMap((f) =>
      chunkSource(f.fileId, service.repo.content(snapshot, f.fileId))
    ),
    context = new SourceContext(service.repo, snapshot, chunks, indexes, signal)
  const evidence = snapshot.files.map((f) => ({
    file: f,
    code: context.read(f.fileId, 0, service.repo.content(snapshot, f.fileId).length)
  }))
  const system = [
    CODE_FLOW_PROMPT_RULES,
    buildLanguageSpecificSystemPrompt(language),
    '离线直接全量输入对照：一次阅读所有文件，通过submit_direct_multifile提交文件语义索引、局部结构流程及有证据的关系。覆盖旧协议的Mermaid提交格式。单元ID和调用点ID在全部文件中唯一，range引用原始UTF-16偏移和1起始行列，终点列排他，使用输入证据ID。节点使用局部ID，程序合并；独立单元保持独立；声明可空流程，必须说明原因。禁止内部推理、无证据关系和虚假节点。'
  ].join('\n\n')
  const agent = createAgent({
    model: createOpenAIModel(),
    tools: [],
    systemPrompt: system,
    responseFormat: toolStrategy(DirectSchema.meta({ title: 'submit_direct_multifile' }), {
      handleError: false
    }),
    middleware: [
      budget.middleware('generate', system, JSON.stringify(z.toJSONSchema(DirectSchema)).length),
      modelCallLimitMiddleware({ runLimit: 1, exitBehavior: 'error' })
    ]
  })
  const started = Date.now(),
    output = await agent.invoke(
      { messages: [new HumanMessage(JSON.stringify({ language, evidence }))] },
      { signal, callbacks: budget.callbacks('generate') }
    )
  const draft = DirectSchema.parse(output.structuredResponse)
  indexes.push(...draft.indexes)
  const units = indexes.flatMap((i) => i.units)
  if (
    new Set(units.map((u) => u.unitId)).size !== units.length ||
    draft.flows.length !== units.length ||
    new Set(draft.flows.map((f) => f.unitId)).size !== units.length
  )
    throw new Error('全量对照执行单元身份或流程不完整。')
  const coverage = {
    complete: true,
    files: snapshot.files.map((file) => {
      const index = indexes.find((i) => i.fileId === file.fileId),
        length = service.repo.content(snapshot, file.fileId).length,
        missing = missingRanges(length, index?.analyzedRanges ?? [])
      if (
        !index ||
        index.status !== 'complete' ||
        missing.length ||
        index.units.some((u) => !u.complete) ||
        index.unresolvedItems.some((u) => u.blocking)
      )
        throw new Error('全量对照没有完成全部文件覆盖。')
      for (const unit of index.units) context.validate(unit.range, unit.evidenceIds)
      return { fileId: file.fileId, total: length, covered: length, missing: [] }
    })
  }
  // 离线对照也必须经过相同的程序证据校验，不能把模型自报关系当作正确答案。
  draft.references.forEach((ref) => validateResolvedReference(ref, context, units))
  const result = composeMultiFileFlow(context, draft.flows, draft.references, {
    version: 2,
    snapshotId: snapshot.snapshotId,
    analysisId: randomUUID(),
    detectedLanguage: language,
    diagnostics: [],
    coverage
  })
  return {
    result,
    proposedReferences: draft.references,
    metrics: { ...budget.summary(), durationMs: Date.now() - started }
  }
}
export function scoreMultiFileCase(
  result: MultiFileFlowResult,
  snapshot: SourceSnapshot,
  expected: z.infer<typeof CaseSchema>
) {
  const path = (fileId: string) => snapshot.files.find((f) => f.fileId === fileId)?.path
  const controls = expected.controls.map((control) => ({
    ...control,
    found: result.mappings.some(
      (mapping) =>
        path(mapping.fileId) === control.path &&
        mapping.kind === control.kind &&
        mapping.lineStart <= control.line &&
        mapping.lineEnd >= control.line
    )
  }))
  const mappings = new Map(result.mappings.map((m) => [m.nodeId, m]))
  const actual = result.mermaid.split('\n').flatMap((line) => {
    const match = /^(n_\w+) -\.->\|"(?:调用|触发)"\| (n_\w+)$/.exec(line)
    if (!match) return []
    return [
      {
        fromPath: path(mappings.get(match[1]!)!.fileId),
        toPath: path(mappings.get(match[2]!)!.fileId)
      }
    ]
  })
  const found = expected.calls.filter((call) =>
    actual.some((edge) => edge.fromPath === call.fromPath && edge.toPath === call.toPath)
  ).length
  return {
    coverageComplete: result.coverage.complete,
    controls,
    controlRecall: controls.length
      ? controls.filter((c) => c.found).length / controls.length
      : null,
    relationshipRecall: expected.calls.length ? found / expected.calls.length : null,
    relationshipPrecision: actual.length
      ? actual.filter((edge) =>
          expected.calls.some(
            (call) => call.fromPath === edge.fromPath && call.toPath === edge.toPath
          )
        ).length / actual.length
      : null,
    notes: '仅检查人工标注的控制位置和文件间关系，不能证明未标注语义正确；全量对照关系需单独审查。'
  }
}
async function main() {
  dotenv.config()
  const inputPath = process.argv[2]
  if (!inputPath)
    throw new Error('用法：tsx src/eval/run-multifile.ts <含源码及人工标注的JSON> [报告路径]')
  const cases = z.array(CaseSchema).parse(JSON.parse(await readFile(resolve(inputPath), 'utf8'))),
    reports: unknown[] = []
  for (const item of cases) {
    const saver = SqliteSaver.fromConnString(':memory:')
    try {
      const sessions = new SessionService(saver),
        service = new MultiFileService(saver),
        id = randomUUID()
      await sessions.create({ id, title: item.name })
      const snapshot = await service.createSnapshot(id, item.files),
        signal = AbortSignal.timeout(Number(process.env.CODE2FLOW_MULTI_TIMEOUT_MS ?? 900000))
      const runs: Array<{ mode: string; metrics: unknown; score: unknown }> = []
      for (const mode of ['indexed-first', 'indexed-cached']) {
        let metrics: unknown
        const result = await service.generate(
          id,
          snapshot.snapshotId,
          signal,
          (type, data) => {
            if (type === 'metadata' && data && typeof data === 'object' && 'usage' in data)
              metrics = data.usage
          },
          'eval'
        )
        runs.push({ mode, metrics, score: scoreMultiFileCase(result, snapshot, item) })
      }
      const detected = service.repo.get(id, snapshot.snapshotId)
      try {
        const direct = await directBaseline(service, detected, signal)
        reports.push({
          name: item.name,
          runs,
          direct: {
            metrics: direct.metrics,
            score: scoreMultiFileCase(direct.result, snapshot, item),
            proposedReferences: direct.proposedReferences
          }
        })
      } catch {
        reports.push({
          name: item.name,
          runs,
          direct: { failed: true, note: '全量对照请求/上下文/结构失败，不计为完整成功。' }
        })
      }
    } catch {
      reports.push({
        name: item.name,
        indexed: {
          failed: true,
          note: '索引分析请求、上下文、预算或校验失败；不记为完整成功，继续后续案例。'
        }
      })
    } finally {
      saver.db.close()
    }
  }
  const output = resolve(process.argv[3] ?? '.code2flow/eval/multifile-report.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(reports, null, 2), 'utf8')
  console.info('多文件离线对照报告已写入：', output)
}
if (require.main === module)
  void main().catch(() => {
    console.error('多文件离线评估失败，请检查案例、供应商配置及预算。')
    process.exitCode = 1
  })
