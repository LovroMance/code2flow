import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AnalysisBudget,
  AnalysisLimitError,
  ContextLimitError,
  ModelConfigurationError,
  runMultiFileChain,
  type AnalysisTaskContext
} from '../ai/chains/multifile.chain'
import { modelRangeResolver, restoreModelDraft, restoreModelIndex } from '../ai/chains/multifile-output'
import type { MultiFileRuntime, TaskOutcome } from '../ai/graph/multifile.graph'
import { runDetectLanguage } from '../ai/tools/detect-language.tool'
import {
  ExecutionUnitSchema,
  FileSemanticIndexSchema,
  OverviewSubmissionSchema,
  UnitFlowDraftSchema,
  type FileSemanticIndex,
  type ExecutionUnit,
  type UnitFlowDraft,
  type CrossFileReference,
  type PublicDiagnostic,
  type MultiFileFlowResult
} from '../domain/multifile/schema'
import type { CodeChunk, SourceRange, SourceSnapshot } from '../domain/source/schema'
import { EvidenceSchema } from '../domain/source/schema'
import { SourceContext } from './source-context.service'
import {
  completeIndexReferences,
  referenceCandidates,
  validateResolvedReference
} from './reference-resolution.service'
import type { SourceRepository } from '../repositories/source.repository'
import {
  coveredLines,
  languageSample,
  sha256,
  sourceRange
} from '../utils/sourcePositions'
import {
  collectUnitControlIssues,
  composeMultiFileFlow,
  validateUnitDraft
} from '../utils/composeMultiFileFlow'
import { safeErrorDetails } from '../ai/observability/safe-error'
import {
  DraftTopologyError,
  ModelOutputTruncatedError,
  ModelOutputValidationError,
  errorCauses
} from '../domain/multifile/errors'
import { traceStep } from '../ai/observability/langsmith'

const CachedIndexSchema = z.object({
  index: FileSemanticIndexSchema,
  evidence: z.array(EvidenceSchema),
  drafts: z.array(UnitFlowDraftSchema).default([])
})
type ControlIssues = ReturnType<typeof collectUnitControlIssues>

function controlFeedback(issues: ControlIssues) {
  const listed = issues.slice(0, 20).map((issue) => issue.message).join('；')
  const remaining = issues.length - 20
  return `请修正这些流程出口：${listed}${remaining > 0 ? `；另有 ${remaining} 处，请检查其余判断和结束节点的连线` : ''}。保留已正确表达的阶段，并合并结果相同的条件。`
}
/** 一次分析的业务上下文：持有索引、证据与局部结果，实现图节点操作。
 * 阶段顺序和重试由 multifile.graph 决定，本类不另建状态机。
 */
export class AnalysisRuntime implements MultiFileRuntime {
  readonly budgetTracker: AnalysisBudget
  readonly concurrency: number
  readonly retries: number
  chunks: CodeChunk[] = []
  indexes: FileSemanticIndex[] = []
  private readonly partial = new Map<string, z.infer<typeof CachedIndexSchema>>()
  private readonly preparedDrafts = new Map<string, UnitFlowDraft>()
  readonly drafts = new Map<string, UnitFlowDraft>()
  // 保留结构合格的草稿，避免重试退步时丢弃可用结果。
  private readonly draftCandidates = new Map<
    string,
    { draft: UnitFlowDraft; issues: ControlIssues }
  >()
  readonly references: CrossFileReference[] = []
  readonly diagnostics: PublicDiagnostic[] = []
  context?: SourceContext
  constructor(
    readonly repo: SourceRepository,
    readonly snapshot: SourceSnapshot,
    readonly analysisId: string,
    readonly signal: AbortSignal,
    private readonly emit: (metadata: Record<string, unknown>) => void,
    private readonly stop: (reason: unknown) => void
  ) {
    this.budgetTracker = new AnalysisBudget(signal)
    this.concurrency = this.budgetTracker.config.concurrency
    this.retries = this.budgetTracker.config.retries
  }
  /** 在模型请求前检查配置与输入限制，避免执行到中途才发现基础条件缺失。 */
  async prepare() {
    this.signal.throwIfAborted()
    if (
      !process.env.DEEPSEEK_API_KEY?.trim() ||
      !process.env.DEEPSEEK_MODEL?.trim() ||
      !Number.isFinite(Number(process.env.DEEPSEEK_TEMPERATURE ?? 0))
    )
      throw new ModelConfigurationError('生成模型密钥、模型名称或温度配置无效。')
    try {
      const baseURL = process.env.DEEPSEEK_BASE_URL
      if (!baseURL) throw new Error()
      const url = new URL(baseURL)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      throw new ModelConfigurationError('生成模型端点配置无效。')
    }
    this.progress('prepare', 0, this.snapshot.files.length)
  }
  /** 同一快照只检测一次语言；已有 unknown 也复用，生成角色不能改写检测结果。 */
  async detect() {
    this.progress('detect', 0, 1)
    if (!this.snapshot.languageDetection) {
      this.snapshot.languageDetection = await runDetectLanguage(
        languageSample(
          this.snapshot.files.map((f) => ({
            path: f.path,
            content: this.repo.content(this.snapshot, f.fileId)
          }))
        ),
        this.signal
      )
      this.signal.throwIfAborted()
      this.repo.saveDetection(this.snapshot)
    }
    this.progress('detect', 1, 1)
    return this.snapshot.languageDetection
  }
  /** 为全部文件建立保留原始位置的分块。 */
  async basic() {
    this.signal.throwIfAborted()
    this.progress('basic', 0, this.snapshot.files.length)
    this.chunks = await this.repo.basicChunks(this.snapshot, this.budgetTracker.config)
    this.signal.throwIfAborted()
    this.repo.saveChunks(this.snapshot, this.chunks)
    this.progress('chunks-ready', this.chunks.length, this.chunks.length)
    this.progress('basic', this.chunks.length, this.chunks.length)
    this.progress('index', 0, this.chunks.length)
  }
  /** 每个源码块都有索引任务，保证长文件尾部也会进入语义分析。 */
  indexTasks() {
    return this.chunks.map((c) => `index:${c.chunkId}`)
  }
  /** 合并后的每个执行单元只生成一次，调用关系通过后续连边表达。 */
  generationTasks() {
    return this.indexes.flatMap((i) => i.units).map((u) => `generate:${u.unitId}`)
  }
  /** 将阻塞语义问题定位到可重新分析的源码块。 */
  blockingIndexTasks(ranges: SourceRange[]) {
    return this.chunks
      .filter((chunk) =>
        ranges.some(
          (range) =>
            range.fileId === chunk.fileId &&
            range.startOffset < chunk.endOffset &&
            range.endOffset > chunk.startOffset
        )
      )
      .map((chunk) => `index:${chunk.chunkId}`)
  }
  /** 缓存绑定源码、路径、语言及模型配置，防止相同正文在不同语境下误复用。 */
  private key(chunk: CodeChunk) {
    return sha256(
      JSON.stringify({
        hash: chunk.contentHash,
        path: this.snapshot.files.find((f) => f.fileId === chunk.fileId)!.path,
        start: chunk.startOffset,
        end: chunk.endOffset,
        language: this.snapshot.languageDetection?.language,
        model: process.env.DEEPSEEK_MODEL,
        base: process.env.DEEPSEEK_BASE_URL,
        temperature: process.env.DEEPSEEK_TEMPERATURE,
        chunker: chunk.chunkerVersion,
        version: 'index-with-overview-v7'
      })
    )
  }
  private modelRanges(fileId: string) {
    return modelRangeResolver(
      fileId,
      this.repo.content(this.snapshot, fileId),
      this.repo.offsets(this.snapshot, fileId)
    )
  }
  /** 检查任务归属、范围和证据；schema 合法并不代表模型真的读过对应源码。 */
  private async checkIndex(index: FileSemanticIndex, chunk: CodeChunk, context: SourceContext) {
    if (index.fileId !== chunk.fileId) throw new ModelOutputValidationError('分块文件身份错误。')
    const ids = new Set<string>(),
      unitEnds = new Map<string, number>()
    for (const unit of index.units) {
      if (ids.has(unit.unitId)) throw new ModelOutputValidationError('临时单元ID重复。')
      ids.add(unit.unitId)
      if (unit.range.fileId !== index.fileId) throw new ModelOutputValidationError('单元跨文件。')
      if (unit.range.startOffset < chunk.startOffset || unit.range.endOffset > chunk.endOffset)
        throw new ModelOutputValidationError('单元超出分配的源码块。')
      context.validate(unit.range, unit.evidenceIds)
      const unitKey = JSON.stringify([unit.scope, unit.name, unit.range.startOffset])
      const previousEnd = unitEnds.get(unitKey)
      if (previousEnd !== undefined && previousEnd !== unit.range.endOffset)
        throw new ModelOutputValidationError('同一作用域和起点的同名单元提交了不同结束行。')
      unitEnds.set(unitKey, unit.range.endOffset)
      const calls = new Set<string>()
      for (const [callIndex, call] of unit.callSites.entries()) {
        context.validate(call.range, call.evidenceIds)
        const fileContent = this.repo.content(this.snapshot, call.range.fileId)
        const source = fileContent.slice(call.range.startOffset, call.range.endOffset)
        if (!source.includes(call.text) || !source.includes(call.targetHint)) {
          const { lineStart, lineEnd } = coveredLines(call.range)
          throw new ModelOutputValidationError(
            `调用点units[${index.units.indexOf(unit)}].callSites[${callIndex}]无效：第 ${lineStart}–${lineEnd} 行原文为"${source}"，提交的text为"${call.text}"、targetHint为"${call.targetHint}"。两者都须逐字出现在原文内。`
          )
        }
        if (calls.has(call.callSiteId)) throw new ModelOutputValidationError('同一执行单元内调用点 ID 重复。')
        calls.add(call.callSiteId)
        if (
          call.range.startOffset < unit.range.startOffset ||
          call.range.endOffset > unit.range.endOffset
        )
          throw new ModelOutputValidationError('调用点超出单元。')
        const match = source.indexOf(call.text)
        if (call.text && call.text.includes(call.targetHint) && source.indexOf(call.text, match + 1) === -1) {
          const start = call.range.startOffset + match
          call.range = sourceRange(call.range.fileId, fileContent, start, start + call.text.length)
        }
      }
    }
    await completeIndexReferences(index, context)
    // 模型提交的行号已转换为规范范围，这里只检查未解决项的文件归属。
    if (index.unresolvedItems.some((item) => item.range.fileId !== index.fileId))
      throw new ModelOutputValidationError('未解决项超出当前索引文件。')
  }
  /** 命中语义缓存后重新登记本次文件与证据身份，不能直接沿用旧 evidenceId。 */
  private rebind(
    cached: z.infer<typeof CachedIndexSchema>,
    chunk: CodeChunk,
    context: SourceContext
  ) {
    const aliases = new Map<string, string>()
    for (const old of cached.evidence) {
      const fresh = context.read(chunk.fileId, old.startOffset, old.endOffset).evidence
      aliases.set(old.evidenceId, fresh.evidenceId)
    }
    // 缓存严格限于本文件事实；重命名和路径上下文改变均不命中。
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite)
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            key === 'fileId'
              ? chunk.fileId
              : key === 'evidenceIds'
                ? (item as string[]).map((id) => aliases.get(id) ?? 'invalid')
                : rewrite(item)
          ])
        )
      return value
    }
    const index = FileSemanticIndexSchema.parse(rewrite(cached.index))
    for (const item of index.unresolvedItems) context.validateRange(item.range)
    return { index, drafts: z.array(UnitFlowDraftSchema).parse(rewrite(cached.drafts)) }
  }
  /** 按任务前缀执行索引、核对或生成；返回安全的失败反馈，由 graph 决定是否重试。 */
  async task(id: string, attempts: number, feedback: string | null): Promise<TaskOutcome> {
    return traceStep(
      'code2flow.analysis-task',
      { taskId: id, attempt: attempts, validationFeedback: feedback },
      async () => {
        try {
          return await this.executeTask(id, attempts, feedback)
        } catch (error) {
          this.stop(error)
          throw error
        }
      },
      { metadata: { task_id: id, attempt: attempts, analysis_id: this.analysisId } }
    )
  }
  private async executeTask(
    id: string,
    attempts: number,
    feedback: string | null
  ): Promise<TaskOutcome> {
    let cacheKey: string | undefined
    let taskRange: SourceRange | undefined
    let generationUnit: ExecutionUnit | undefined
    let wholeFile = false
    const withTaskLocation = (error: unknown) => {
      if (!taskRange || !(error instanceof ContextLimitError || error instanceof ModelOutputTruncatedError))
        return error
      const { fileId } = taskRange
      const file = this.snapshot.files.find((file) => file.fileId === fileId)!
      const { lineStart, lineEnd } = coveredLines(taskRange)
      const location = `${file.path} 第 ${lineStart}–${lineEnd} 行`
      if (error instanceof ModelOutputTruncatedError)
        return new ModelOutputTruncatedError(`${location}：${error.message}`)
      return new ContextLimitError(
        wholeFile
          ? `${location} 无法按语法分块，整文件超过模型上下文。请使用上下文更大的模型。`
          : `${location} 的任务超过模型上下文。请减小切块目标或使用上下文更大的模型，完整语法单元会保留。`
      )
    }
    const taskContext: AnalysisTaskContext = {
      analysisId: this.analysisId,
      taskId: id,
      attempt: attempts,
      onTerminal: (error) => this.stop(withTaskLocation(error))
    }
    try {
      this.signal.throwIfAborted()
      if (id.startsWith('index:')) {
        const chunk = this.chunks.find((c) => `index:${c.chunkId}` === id)!
        taskRange = chunk
        wholeFile = chunk.strategy === 'whole-file'
        const context = new SourceContext(
          this.repo,
          this.snapshot,
          this.chunks,
          [],
          this.signal
        )
        context.allowedFileId = chunk.fileId
        cacheKey = this.key(chunk)
        const cachedValue = feedback
          ? undefined
          : (
              await traceStep('code2flow.index-cache', { cacheKey }, async () => {
                const value = this.repo.cacheGet(cacheKey!)
                return { hit: value !== undefined, value }
              })
            ).value
        const cached = cachedValue === undefined ? undefined : CachedIndexSchema.parse(cachedValue)
        let restored: ReturnType<typeof restoreModelIndex>
        if (cached) {
          restored = this.rebind(cached, chunk, context)
        } else {
          const { content, evidence } = context.read(chunk.fileId, chunk.startOffset, chunk.endOffset)
          const submission = await runMultiFileChain(
            'index',
            {
              file: { path: this.snapshot.files.find((f) => f.fileId === chunk.fileId)!.path },
              taskRange: { ...coveredLines(chunk), javaScope: chunk.javaScope },
              code: { content }
            },
            context,
            this.snapshot.languageDetection!.language,
            this.budgetTracker,
            feedback ?? undefined,
            taskContext
          )
          restored = restoreModelIndex(submission, evidence, this.modelRanges(chunk.fileId))
        }
        await this.checkIndex(restored.index, chunk, context)
        // 缓存只允许本文件的源码凭证。
        if ([...context.evidence.values()].some((e) => e.fileId !== chunk.fileId))
          throw new ModelOutputValidationError('文件分析任务只能读取本文件上下文。')
        this.signal.throwIfAborted()
        const part = {
          ...restored,
          evidence: [...context.evidence.values()]
        }
        if (!cached) this.repo.cachePut(cacheKey, part)
        this.partial.set(chunk.chunkId, part)
      } else {
        const unit = this.indexes
          .flatMap((i) => i.units)
          .find((u) => `generate:${u.unitId}` === id)!
        generationUnit = unit
        taskRange = unit.range
        const { fileId, startOffset, endOffset } = unit.range
        const context = this.context!
        const candidate = this.draftCandidates.get(unit.unitId)
        let draft: UnitFlowDraft | undefined
        let previousDraft = feedback ? candidate?.draft : undefined
        let modelFeedback = feedback ?? undefined
        let generated = false
        const prepared = this.preparedDrafts.get(unit.unitId)
        if (prepared) {
          this.preparedDrafts.delete(unit.unitId)
          try {
            this.acceptDraft(prepared, unit, context)
            draft = prepared
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error
            modelFeedback = error.message
            if (error instanceof DraftTopologyError && prepared.nodes.some(({ kind }) => kind !== 'start'))
              previousDraft = prepared
          }
        }
        if (!draft) {
          const key = sha256(JSON.stringify(
            {
              unit: ExecutionUnitSchema.parse(unit),
              language: this.snapshot.languageDetection?.language,
              model: process.env.DEEPSEEK_MODEL,
              base: process.env.DEEPSEEK_BASE_URL,
              temperature: process.env.DEEPSEEK_TEMPERATURE,
              version: 'flow-overview-v6'
            },
            (key, value) => key === 'evidenceIds' ? undefined : value
          ))
          cacheKey = key
          const { value: cached } = await traceStep('code2flow.generation-cache', { cacheKey: key }, async () => {
            const value = this.repo.cacheGet(key)
            return { hit: value !== undefined, value }
          })
          if (cached) {
            const old = UnitFlowDraftSchema.parse(cached)
            draft = {
              ...old,
              nodes: old.nodes.map((node) => ({
                ...node,
                evidenceIds: unit.evidenceIds
              }))
            }
            this.acceptDraft(draft, unit, context)
          } else {
            let payload: unknown
            let evidenceIds = unit.evidenceIds
            if (previousDraft) {
              const fragments = (candidate?.issues ?? [])
                .filter(({ needsSource }) => needsSource)
                .map(({ range }) => ({ content: context.read(fileId, range.startOffset, range.endOffset).content }))
              payload = {
                unit: { ...unit, callSites: unit.callSites.map(({ text, ...site }) => site) },
                previousDraft,
                ...(fragments.length ? { codeFragments: fragments } : {})
              }
            } else {
              const { content, evidence } = context.read(fileId, startOffset, endOffset)
              evidenceIds = [evidence.evidenceId]
              payload = {
                unit,
                code: { content },
                relatedReferences: this.references.filter((r) => r.sourceUnitId === unit.unitId),
                unresolved: this.indexes.find((i) => i.fileId === fileId)!.unresolvedItems.filter(
                  ({ range }) => range.startOffset < endOffset && range.endOffset > startOffset
                )
              }
            }
            const submission = await runMultiFileChain(
              'generate',
              payload,
              context,
              this.snapshot.languageDetection!.language,
              this.budgetTracker,
              modelFeedback,
              taskContext
            )
            draft = restoreModelDraft(submission, unit.unitId, evidenceIds, this.modelRanges(fileId))
            this.acceptDraft(draft, unit, context, evidenceIds)
            generated = true
          }
        }
        const issues = collectUnitControlIssues(draft)
        this.signal.throwIfAborted()
        if (issues.length) {
          if (cacheKey && !generated) this.repo.cacheDelete(cacheKey)
          const retained =
            candidate && candidate.issues.length < issues.length
              ? candidate
              : { draft, issues }
          this.draftCandidates.set(unit.unitId, retained)
          if (attempts <= this.retries)
            return { taskId: id, attempts, error: controlFeedback(retained.issues) }
          this.finishDraftCandidate(unit)
        } else {
          this.draftCandidates.delete(unit.unitId)
          this.drafts.set(unit.unitId, draft)
          if (generated && cacheKey) this.repo.cachePut(cacheKey, draft)
        }
      }
      return { taskId: id, attempts, error: null }
    } catch (error) {
      this.signal.throwIfAborted()
      const causes = errorCauses(error)
      const reason =
        causes.find(
          (cause) =>
            cause instanceof ModelOutputTruncatedError ||
            cause instanceof AnalysisLimitError ||
            cause instanceof ModelConfigurationError
        ) ??
        causes.find((cause) => cause instanceof ModelOutputValidationError) ??
        error
      const retryable = reason instanceof ModelOutputValidationError
      // 仅保留失败摘要，详细执行过程通过 LangSmith 查看。
      if (!retryable)
        console.error('[code-flow][v2] task-failed', {
          taskId: id,
          error: safeErrorDetails(error)
        })
      if (cacheKey) this.repo.cacheDelete(cacheKey)
      if (!retryable) throw withTaskLocation(reason)
      if (generationUnit && attempts > this.retries && this.finishDraftCandidate(generationUnit))
        return { taskId: id, attempts, error: null }
      return { taskId: id, attempts, error: reason.message }
    }
  }
  /** 汇总分块索引、证据并建立正式单元和调用点身份。 */
  merge() {
    const unitAliases = new Map<string, string>()
    const callAliases = new Map<string, Map<string, string>>()
    this.indexes = this.snapshot.files.map((file): FileSemanticIndex => {
      const parts = this.chunks
        .filter((chunk) => chunk.fileId === file.fileId)
        .map(({ chunkId }) => [chunkId, this.partial.get(chunkId)!.index] as const)
      const units = new Map<string, ExecutionUnit>()
      const references: FileSemanticIndex['references'] = []
      for (const [chunkId, part] of parts) {
        for (const unit of part.units) {
          const key = JSON.stringify([
            file.fileId,
            unit.range.startOffset,
            unit.range.endOffset,
            unit.name,
            unit.scope,
            unit.kind
          ])
          const old = units.get(key)
          if (old) {
            unitAliases.set(`${chunkId}|${unit.unitId}`, old.unitId)
            old.evidenceIds = [...new Set([...old.evidenceIds, ...unit.evidenceIds])]
            old.callSites = [
              ...new Map(
                [...old.callSites, ...unit.callSites].map((c) => [
                  JSON.stringify([c.range.startOffset, c.range.endOffset, c.kind, c.targetHint, c.text]),
                  c
                ])
              ).values()
            ]
          } else {
            const formal = `u_${sha256(key).slice(0, 10)}`
            unitAliases.set(`${chunkId}|${unit.unitId}`, formal)
            units.set(key, { ...unit, unitId: formal })
          }
        }
        references.push(...part.references)
      }
      const fileUnits = [...units.values()].sort(
        (a, b) => a.range.startOffset - b.range.startOffset || b.range.endOffset - a.range.endOffset
      )
      for (const unit of fileUnits) {
        const calls = new Map<string, string>()
        unit.callSites = unit.callSites.map((c, index) => {
          const formal = `call_${sha256(JSON.stringify([unit.unitId, c.range.startOffset, c.range.endOffset, index])).slice(0, 10)}`
          calls.set(c.callSiteId, formal)
          return { ...c, callSiteId: formal }
        })
        callAliases.set(unit.unitId, calls)
      }
      const unresolvedItems = parts.flatMap(([, index]) => index.unresolvedItems)
      return {
        fileId: file.fileId,
        summary: parts
          .map(([, index]) => index.summary)
          .join('；')
          .slice(0, 1000),
        units: fileUnits,
        references: [
          ...new Map(
            references.map((r) => [JSON.stringify([r.range, r.name, r.alias, r.targetPath]), r])
          ).values()
        ],
        unresolvedItems,
        status: unresolvedItems.some((item) => item.blocking) ? 'partial' : 'complete',
        schemaVersion: '2'
      }
    })
    this.context = new SourceContext(
      this.repo,
      this.snapshot,
      this.chunks,
      this.indexes,
      this.signal
    )
    for (const { evidence } of this.partial.values())
      for (const item of evidence) {
        this.context.evidence.set(item.evidenceId, item)
        this.context.accessible.add(item.evidenceId)
      }
    // 单元临时 ID 属于分块，调用点临时 ID 属于单元。返修后从最新索引重建草稿。
    this.preparedDrafts.clear()
    for (const [chunkId, { drafts }] of this.partial) {
      for (const draft of drafts) {
        const formalUnit = unitAliases.get(`${chunkId}|${draft.unitId}`)
        if (!formalUnit || this.preparedDrafts.has(formalUnit)) continue
        const calls = callAliases.get(formalUnit)!
        this.preparedDrafts.set(formalUnit, {
          ...draft,
          unitId: formalUnit,
          nodes: draft.nodes.map((node) => ({
            ...node,
            callSiteIds: node.callSiteIds.map((id) => calls.get(id) ?? id)
          }))
        })
      }
    }
  }
  /** 生成结果的共同验收：身份、范围证据、引用约束与已确认调用点覆盖。 */
  private acceptDraft(
    draft: UnitFlowDraft,
    unit: ExecutionUnit,
    context: SourceContext,
    additionalEvidenceIds: string[] = []
  ) {
    if (draft.unitId !== unit.unitId) throw new ModelOutputValidationError('返回了其他执行单元。')
    validateUnitDraft(draft, context)
    const permitted = new Set([...unit.evidenceIds, ...additionalEvidenceIds])
    for (const node of draft.nodes)
      if (node.evidenceIds.some((id) => !permitted.has(id)))
        throw new ModelOutputValidationError('生成引用了未提供的证据。')
    const expected = unit.callSites.filter((call) =>
      this.references.some((r) => r.callSiteId === call.callSiteId && r.status === 'resolved')
    )
    if (
      expected.some(
        (call) => !draft.nodes.some((node) => node.callSiteIds.includes(call.callSiteId))
      )
    )
      throw new ModelOutputValidationError('已确认调用点没有映射到节点。')
  }
  /** 仅发布通过结构校验的候选，并把剩余问题定位到对应单元和源码行。 */
  private finishDraftCandidate(unit: ExecutionUnit) {
    const candidate = this.draftCandidates.get(unit.unitId)
    if (!candidate) return false
    this.draftCandidates.delete(unit.unitId)
    this.drafts.set(unit.unitId, candidate.draft)
    this.reportControlIssues(unit, candidate.issues)
    return true
  }

  private reportControlIssues(unit: ExecutionUnit, issues: ControlIssues) {
    if (!issues.length) return
    const file = this.snapshot.files.find((file) => file.fileId === unit.range.fileId)!
    const location = `${file.path} · ${unit.name || unit.kind}`.slice(0, 800)
    for (const { range, message } of issues)
      this.diagnostics.push({
        code: 'flow_control_incomplete',
        fileId: range.fileId,
        range,
        message: `${location}：${message}，请对照源码确认。`
      })
  }
  /** 依据静态候选和源码证据绑定调用，保留未解析关系。 */
  resolve() {
    this.references.length = 0
    const unitCount = this.indexes.reduce((count, index) => count + index.units.length, 0)
    this.progress('resolve', 0, unitCount)
    for (const candidate of referenceCandidates(this.snapshot, this.indexes)) {
      const { unit, call, candidates, imports, scopeEvidence } = candidate
      const ref: CrossFileReference = {
        referenceId: randomUUID(),
        sourceUnitId: unit.unitId,
        callSiteId: call.callSiteId,
        targetHint: call.targetHint,
        kind: call.kind,
        status: 'unresolved',
        evidenceIds: call.evidenceIds,
        diagnostic:
          candidates.length > 1 ? '存在多个目标，保留未解析。' : '缺少上传实现或静态绑定依据。'
      }
      if (unit.complete && candidates.length === 1 && candidates[0]!.complete) {
        const target = candidates[0]!
        ref.targetUnitId = target.unitId
        ref.evidenceIds = [
          ...new Set([
            ...call.evidenceIds,
            ...target.evidenceIds,
            ...imports.flatMap((r) => r.evidenceIds),
            ...scopeEvidence.flatMap((r) => r.evidenceIds)
          ])
        ]
        ref.status = 'resolved'
        ref.diagnostic = '通过调用位置、唯一作用域或导入路径绑定核对。'
        try {
          validateResolvedReference(ref, this.context!, candidate, target)
        } catch {
          ref.status = 'unresolved'
          ref.targetUnitId = undefined
          ref.diagnostic = '候选目标尚未具备完整绑定证据。'
        }
      }
      this.references.push(ref)
    }
    this.progress('resolve', unitCount, unitCount)
  }
  /** 将未解决的语义问题和关系整理为公开诊断。 */
  finishReferences() {
    for (const index of this.indexes)
      for (const item of index.unresolvedItems)
        this.diagnostics.push({
          code: 'unresolved_semantics',
          message: item.description,
          fileId: index.fileId,
          range: item.range
        })
    for (const ref of this.references)
      if (ref.status !== 'resolved')
        this.diagnostics.push({
          code: 'unresolved_reference',
          message: ref.diagnostic,
          fileId: this.indexes.flatMap((i) => i.units).find((u) => u.unitId === ref.sourceUnitId)
            ?.range.fileId
        })
  }
  /** 只检查阻塞项：文件级范围完整性由切块校验和逐块索引保证，无需重复统计。 */
  coverage() {
    const unresolvedRanges = this.indexes.flatMap((index) =>
      index.unresolvedItems.filter((item) => item.blocking).map((item) => item.range)
    )
    return { complete: !unresolvedRanges.length, unresolvedRanges }
  }
  /** 把局部结构交给程序统一组图，生成模型没有直接提交最终 Mermaid 的权限。 */
  compose() {
    return composeMultiFileFlow(this.context!, [...this.drafts.values()], this.references, {
      version: 2,
      snapshotId: this.snapshot.snapshotId,
      analysisId: this.analysisId,
      detectedLanguage: this.snapshot.languageDetection!.language,
      diagnostics: this.diagnostics,
      coverage: this.coverage()
    })
  }

  /** 总体图只读取已通过验收的阶段、索引职责及已确认的单元关系。 */
  async generateOverview(detail: MultiFileFlowResult) {
    const stagesByUnit = new Map<string, string[]>()
    for (const node of detail.mappings) {
      if (node.kind === 'start') continue
      const stages = stagesByUnit.get(node.unitId) ?? []
      if (stages.length < 6) stages.push(node.label.slice(0, 80))
      stagesByUnit.set(node.unitId, stages)
    }
    const files = this.indexes.map((index) => {
      const exports = new Set(index.references.filter(({ kind }) => kind === 'export').map(({ name }) => name))
      return {
        path: this.snapshot.files.find((file) => file.fileId === index.fileId)!.path,
        summary: index.summary.slice(0, 240),
        units: index.units.filter((unit) => stagesByUnit.has(unit.unitId)).map((unit) => ({
          id: unit.unitId,
          kind: unit.kind,
          name: unit.name.slice(0, 100),
          exported: exports.has(unit.name),
          summary: unit.summary.slice(0, 160),
          stages: stagesByUnit.get(unit.unitId)
        }))
      }
    })
    const callPairs = new Set<string>()
    for (const ref of this.references) {
      if (ref.status === 'resolved' && (ref.kind === 'call' || ref.kind === 'registration') && ref.targetUnitId)
        callPairs.add(`${ref.sourceUnitId}:${ref.targetUnitId}`)
    }
    const payload = { files, calls: [...callPairs].map((pair) => pair.split(':')) }
    const key = sha256(JSON.stringify({
      version: 'overview-v3', payload, language: detail.detectedLanguage,
      model: process.env.DEEPSEEK_MODEL, base: process.env.DEEPSEEK_BASE_URL,
      temperature: process.env.DEEPSEEK_TEMPERATURE
    }))
    const cached = OverviewSubmissionSchema.safeParse(this.repo.cacheGet(key))
    const submitted = cached.success ? cached.data : await runMultiFileChain(
      'overview', payload, this.context!, detail.detectedLanguage, this.budgetTracker,
      undefined, { analysisId: this.analysisId, taskId: 'overview', attempt: 1 }
    )
    this.signal.throwIfAborted()
    const nodes = new Map(submitted.nodes.map((node) => [node.id, node]))
    if (nodes.size !== submitted.nodes.length || submitted.nodes.some((node) =>
      node.unitIds.some((unitId) => !stagesByUnit.has(unitId))
    )) throw new ModelOutputValidationError('总体图引用了未知单元或重复节点。')
    const seen = new Set<string>()
    const edges = submitted.edges.filter(({ from, to }) => {
      const source = nodes.get(from), target = nodes.get(to), pair = `${from}:${to}`
      if (!source || !target || from === to || seen.has(pair)) return false
      if (!source.unitIds.some((unitId) => callPairs.has(`${unitId}:${target.unitIds[0]}`)))
        return false
      seen.add(pair)
      return true
    })
    const result = { nodes: submitted.nodes, edges }
    if (!cached.success) this.repo.cachePut(key, result)
    return { status: 'ready' as const, ...result }
  }
  /** 最终提交门槛：每个映射仍指向当前快照的有效证据。 */
  validate(result: ReturnType<AnalysisRuntime['compose']>) {
    this.signal.throwIfAborted()
    // 覆盖完整由 assessCoverage 门禁保证；草稿齐全由 validateUnit 放行条件保证。
    for (const mapping of result.mappings) this.context!.validate(mapping, mapping.evidenceIds)
    this.repo.saveFacts(this.snapshot.snapshotId, this.indexes, this.references, [
      ...this.context!.evidence.values()
    ])
  }
  /** 失败时返回可定位的缺口范围，便于前端解释分析停在哪里。 */
  incompleteRanges() {
    return [
      ...this.chunks
        .filter((c) => !this.partial.has(c.chunkId))
        .map((c) => ({
          phase: 'index',
          fileId: c.fileId,
          path: this.snapshot.files.find((f) => f.fileId === c.fileId)!.path,
          ...coveredLines(c)
        })),
      ...this.indexes
        .flatMap((i) => i.units)
        .filter((u) => !this.drafts.has(u.unitId))
        .map((u) => ({
          phase: u.complete ? 'generate' : 'index',
          fileId: u.range.fileId,
          path: this.snapshot.files.find((f) => f.fileId === u.range.fileId)!.path,
          ...coveredLines(u.range)
        }))
    ]
  }
  progress(stage: string, completed: number, total: number) {
    this.signal.throwIfAborted()
    this.emit({
      version: 2,
      snapshotId: this.snapshot.snapshotId,
      analysisId: this.analysisId,
      detectedLanguage: this.snapshot.languageDetection?.language ?? 'unknown',
      stage,
      completed,
      total,
      diagnostics: this.diagnostics
    })
  }
}
