import { ModelOutputValidationError } from '../domain/multifile/errors'
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
import type { MultiFileRuntime, TaskOutcome } from '../ai/graph/multifile.graph'
import { runDetectLanguage } from '../ai/tools/detect-language.tool'
import {
  FileSemanticIndexSchema,
  UnitFlowDraftSchema,
  type FileSemanticIndex,
  type ExecutionUnit,
  type UnitFlowDraft,
  type CrossFileReference,
  type PublicDiagnostic
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
  missingRanges,
  sha256,
  sourceRange,
  validateSourceRange
} from '../utils/sourcePositions'
import {
  collectUnitControlIssues,
  composeMultiFileFlow,
  validateUnitDraft
} from '../utils/composeMultiFileFlow'
import { safeErrorDetails } from '../ai/observability/safe-error'
import { ModelOutputTruncatedError, errorCauses } from '../domain/multifile/errors'
import { traceStep } from '../ai/observability/langsmith'
import { sourceSwitches } from '../utils/sourceChunks'

const CachedIndexSchema = z.object({
  index: FileSemanticIndexSchema,
  evidence: z.array(EvidenceSchema),
  // 单块文件合并模式随索引一同缓存的局部草稿；旧缓存条目没有该字段。
  drafts: z.array(UnitFlowDraftSchema).optional()
})
type ControlIssues = ReturnType<typeof collectUnitControlIssues>

function controlFeedback(issues: ControlIssues) {
  const listed = issues.slice(0, 20).map((issue) => issue.message).join('；')
  const remaining = issues.length - 20
  return `请一起核对这些控制点：${listed}${remaining > 0 ? `；另有 ${remaining} 处，请逐项检查 unit.controlRanges` : ''}。保留已正确表达的流程。`
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
  readonly partial = new Map<string, FileSemanticIndex>()
  readonly contexts = new Map<string, SourceContext>()
  readonly drafts = new Map<string, UnitFlowDraft>()
  // 保留结构合格的草稿，避免重试退步时丢弃可用结果。
  private readonly draftCandidates = new Map<string, { draft: UnitFlowDraft; issues: ControlIssues }>()
  private readonly switchesByFile = new Map<string, ReturnType<typeof sourceSwitches>>()
  // 合并模式的临时草稿按分块暂存，merge 建立正式身份后重映射进 drafts。
  private readonly partialDrafts = new Map<string, UnitFlowDraft[]>()
  private readonly unitAliases = new Map<string, string>()
  private readonly callAliases = new Map<string, Map<string, string>>()
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
        version: 'index-lines-v4'
      })
    )
  }
  /** 检查任务归属、范围和证据；schema 合法并不代表模型真的读过对应源码。 */
  private async checkIndex(index: FileSemanticIndex, chunk: CodeChunk, context: SourceContext) {
    if (index.fileId !== chunk.fileId) throw new ModelOutputValidationError('分块文件身份错误。')
    if (
      missingRanges(
        chunk.endOffset - chunk.startOffset,
        index.analyzedRanges.map((r) => {
          if (
            r.startOffset < chunk.startOffset ||
            r.endOffset > chunk.endOffset ||
            r.endOffset <= r.startOffset
          )
            throw new ModelOutputValidationError('已分析的源码范围超出任务分配范围。')
          return {
            startOffset: r.startOffset - chunk.startOffset,
            endOffset: r.endOffset - chunk.startOffset
          }
        })
      ).length
    )
      throw new ModelOutputValidationError('分配的源码块没有完整处理。')
    const ids = new Set<string>(),
      calls = new Set<string>(),
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
      for (const control of unit.controlRanges) {
        context.validate(control.range, unit.evidenceIds)
        // 控制位置常带行首缩进或行尾换行等空白噪声，修剪到实际语句并重算行列，
        // 生成节点只需覆盖语句本身即可通过覆盖检查，避免行列级偏差被拒。
        const fileContent = this.repo.content(this.snapshot, unit.range.fileId)
        let s = control.range.startOffset,
          e = control.range.endOffset
        while (s < e && /\s/.test(fileContent[s]!)) s++
        while (e > s && /\s/.test(fileContent[e - 1]!)) e--
        if (e > s) {
          try {
            const trimmed = sourceRange(unit.range.fileId, fileContent, s, e)
            control.range = { ...control.range, ...trimmed }
          } catch {
            // 修剪后落在代理对或边界上时保持原范围，校验交给既有规则。
          }
        }
        if (
          control.range.startOffset < unit.range.startOffset ||
          control.range.endOffset > unit.range.endOffset
        )
          throw new ModelOutputValidationError('控制位置超出单元。')
      }
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
        if (calls.has(call.callSiteId)) throw new ModelOutputValidationError('调用点ID重复。')
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
    for (const item of index.unresolvedItems) {
      try {
        validateSourceRange(
          item.range,
          index.fileId,
          this.repo.content(this.snapshot, index.fileId)
        )
      } catch (error) {
        if (error instanceof Error && error.constructor === Error)
          throw new ModelOutputValidationError(error.message)
        throw error
      }
    }
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
    return {
      index: FileSemanticIndexSchema.parse(rewrite(cached.index)),
      drafts: cached.drafts ? (rewrite(cached.drafts) as UnitFlowDraft[]) : []
    }
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
        // 仅为小文件合并索引和草稿，避免较大的单块同时输出两份结构而截断。
        const withDrafts =
          feedback === null &&
          chunk.endOffset - chunk.startOffset <= 2000 &&
          this.chunks.filter((c) => c.fileId === chunk.fileId).length === 1
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
        let index: FileSemanticIndex
        let drafts: UnitFlowDraft[] = []
        if (cached) {
          const rebound = this.rebind(cached, chunk, context)
          index = rebound.index
          drafts = withDrafts ? rebound.drafts : []
        } else {
          const code = context.read(chunk.fileId, chunk.startOffset, chunk.endOffset)
          const submission = await runMultiFileChain(
            'index',
            {
              file: this.snapshot.files.find((f) => f.fileId === chunk.fileId),
              taskRange: chunk,
              code,
              ...(withDrafts ? { withDrafts: true } : {})
            },
            context,
            this.snapshot.languageDetection!.language,
            this.budgetTracker,
            feedback ?? undefined,
            taskContext,
            withDrafts ? { withDrafts: true } : undefined
          )
          const { drafts: submittedDrafts, ...fields } =
            'drafts' in submission ? submission : { ...submission, drafts: [] }
          drafts = submittedDrafts
          index = {
            ...fields,
            units: fields.units.map((unit) => ({ ...unit, complete: true })),
            status: fields.unresolvedItems.some((item) => item.blocking) ? 'partial' : 'complete',
            schemaVersion: '2'
          }
        }
        await this.checkIndex(index, chunk, context)
        // 缓存只允许本文件的源码凭证。
        if ([...context.evidence.values()].some((e) => e.fileId !== chunk.fileId))
          throw new ModelOutputValidationError('文件分析任务只能读取本文件上下文。')
        this.signal.throwIfAborted()
        // 草稿的单元身份必须能对应到索引单元，否则丢弃并回退到生成角色。
        const indexedUnits = new Set(index.units.map((u) => u.unitId))
        const validDrafts = drafts.filter((draft) => indexedUnits.has(draft.unitId))
        if (withDrafts) this.partialDrafts.set(chunk.chunkId, validDrafts)
        this.repo.cachePut(this.key(chunk), {
          index,
          evidence: [...context.evidence.values()],
          ...(withDrafts && validDrafts.length ? { drafts: validDrafts } : {})
        })
        this.partial.set(id, index)
        this.contexts.set(id, context)
      } else {
        const unit = this.indexes
          .flatMap((i) => i.units)
          .find((u) => `generate:${u.unitId}` === id)!
        generationUnit = unit
        taskRange = unit.range
        const context = this.context!
        const code = context.read(unit.range.fileId, unit.range.startOffset, unit.range.endOffset)
        const file = this.snapshot.files.find((f) => f.fileId === unit.range.fileId)!
        const candidate = this.draftCandidates.get(unit.unitId)
        const payload = {
          unit,
          code,
          relatedReferences: this.references.filter((r) => r.sourceUnitId === unit.unitId),
          unresolved: this.indexes.find((i) => i.fileId === unit.range.fileId)!.unresolvedItems,
          ...(feedback && candidate ? { previousDraft: candidate.draft } : {})
        }
        const stable = (value: unknown): unknown =>
          Array.isArray(value)
            ? value.map(stable)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                  Object.entries(value)
                    .filter(([key]) => key !== 'evidenceIds')
                    .map(([key, item]) => [key, stable(item)])
                )
              : value
        const key = sha256(
          JSON.stringify({
            manifest: this.snapshot.manifestHash,
            unit: stable(unit),
            language: this.snapshot.languageDetection?.language,
            model: process.env.DEEPSEEK_MODEL,
            base: process.env.DEEPSEEK_BASE_URL,
            temperature: process.env.DEEPSEEK_TEMPERATURE,
            version: 'flow-lines-v3'
          })
        )
        cacheKey = key
        let draft: UnitFlowDraft | undefined
        let modelFeedback = feedback ?? undefined
        // 预生成草稿与模型新提交使用同一套验收规则。
        const prepared = this.drafts.get(unit.unitId)
        if (prepared) {
          this.drafts.delete(unit.unitId)
          try {
            this.acceptDraft(prepared, unit, context, code)
            draft = prepared
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error
            modelFeedback = error.message
          }
        }
        if (!draft) {
          // 带反馈时直接重生成，避免再次命中同一份草稿。缓存证据绑定到当前快照。
          const cached = feedback
            ? undefined
            : (
                await traceStep('code2flow.generation-cache', { cacheKey: key }, async () => {
                  const value = this.repo.cacheGet(key)
                  return { hit: value !== undefined, value }
                })
              ).value
          if (cached) {
            const old = UnitFlowDraftSchema.parse(cached)
            draft = {
              ...old,
              nodes: old.nodes.map((node) => ({
                ...node,
                evidenceIds: [code.evidence.evidenceId]
              }))
            }
          } else
            draft = await runMultiFileChain(
              'generate',
              payload,
              context,
              this.snapshot.languageDetection!.language,
              this.budgetTracker,
              modelFeedback,
              taskContext
            )
          this.acceptDraft(draft, unit, context, code)
        }
        let switches = this.switchesByFile.get(file.fileId)
        if (!switches) {
          switches = sourceSwitches(file.fileId, file.path, this.repo.content(this.snapshot, file.fileId))
          this.switchesByFile.set(file.fileId, switches)
        }
        const issues = collectUnitControlIssues(draft, unit, await switches)
        const repairs = issues.filter((issue) => issue.repair)
        this.signal.throwIfAborted()
        if (repairs.length) {
          if (!candidate || repairs.length <= candidate.issues.filter((issue) => issue.repair).length)
            this.draftCandidates.set(unit.unitId, { draft, issues })
          if (attempts <= this.retries)
            return { taskId: id, attempts, error: controlFeedback(repairs), fatal: false }
          this.finishDraftCandidate(unit)
        } else {
          this.draftCandidates.delete(unit.unitId)
          this.drafts.set(unit.unitId, draft)
          this.reportControlIssues(unit, issues)
          this.repo.cachePut(key, draft)
        }
      }
      return { taskId: id, attempts, error: null, fatal: false }
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
        return { taskId: id, attempts, error: null, fatal: false }
      return {
        taskId: id,
        attempts,
        error: reason.message,
        fatal: false
      }
    }
  }
  /** 汇总分块索引、证据并建立正式单元和调用点身份。 */
  merge() {
    this.indexes = this.snapshot.files.map((file): FileSemanticIndex => {
      const parts = this.chunks
        .filter((chunk) => chunk.fileId === file.fileId)
        .map((chunk) => this.partial.get(`index:${chunk.chunkId}`)!)
      const units = new Map<string, ExecutionUnit>()
      const references: FileSemanticIndex['references'] = []
      for (const part of parts) {
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
            // 重复 sightings 的临时ID同样要能映射到正式身份；别名按文件隔离，避免不同文件的临时ID互撞。
            this.unitAliases.set(`${file.fileId}|${unit.unitId}`, old.unitId)
            old.evidenceIds = [...new Set([...old.evidenceIds, ...unit.evidenceIds])]
            old.controlRanges = [
              ...new Map(
                [...old.controlRanges, ...unit.controlRanges].map((c) => [
                  JSON.stringify([c.kind, c.range]),
                  c
                ])
              ).values()
            ]
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
            this.unitAliases.set(`${file.fileId}|${unit.unitId}`, formal)
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
        this.callAliases.set(unit.unitId, calls)
      }
      const unresolvedItems = parts.flatMap((i) => i.unresolvedItems)
      return {
        fileId: file.fileId,
        summary: parts
          .map((i) => i.summary)
          .join('；')
          .slice(0, 1000),
        units: fileUnits,
        references: [
          ...new Map(
            references.map((r) => [JSON.stringify([r.range, r.name, r.alias, r.targetPath]), r])
          ).values()
        ],
        analyzedRanges: parts.flatMap((i) => i.analyzedRanges),
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
    for (const context of this.contexts.values())
      for (const [id, e] of context.evidence) {
        this.context.evidence.set(id, e)
        this.context.accessible.add(id)
      }
    this.repo.saveFacts(
      this.snapshot.snapshotId,
      this.indexes,
      [],
      [...this.context.evidence.values()]
    )
    this.remapDrafts()
  }
  /** 把合并模式暂存的临时草稿重映射到正式单元/调用点身份，供生成阶段直接复用。 */
  private remapDrafts() {
    for (const [chunkId, drafts] of this.partialDrafts) {
      this.partialDrafts.delete(chunkId)
      const fileId = this.chunks.find((c) => c.chunkId === chunkId)?.fileId
      if (!fileId) continue
      for (const draft of drafts) {
        const formalUnit = this.unitAliases.get(`${fileId}|${draft.unitId}`)
        if (!formalUnit || this.drafts.has(formalUnit)) continue
        const calls = this.callAliases.get(formalUnit)
        this.drafts.set(formalUnit, {
          ...draft,
          unitId: formalUnit,
          nodes: draft.nodes.map((node) => ({
            ...node,
            callSiteIds: calls
              ? node.callSiteIds.map((id) => calls.get(id)).filter((id): id is string => !!id)
              : []
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
    code: { evidence: { evidenceId: string } }
  ) {
    if (draft.unitId !== unit.unitId) throw new ModelOutputValidationError('返回了其他执行单元。')
    validateUnitDraft(draft, context)
    // 生成 chain 仅能引用实际进入本次证据包的源码。
    for (const node of draft.nodes)
      if (
        node.evidenceIds.some(
          (e) => e !== code.evidence.evidenceId && !unit.evidenceIds.includes(e)
        )
      )
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
    const units = this.indexes.flatMap((i) => i.units)
    this.progress('resolve', 0, units.length)
    for (const { unit, call, candidates, imports, scopeEvidence } of referenceCandidates(
      this.snapshot,
      this.indexes
    )) {
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
          validateResolvedReference(ref, this.context!, units)
        } catch {
          ref.status = 'unresolved'
          ref.targetUnitId = undefined
          ref.diagnostic = '候选目标尚未具备完整绑定证据。'
        }
      }
      this.references.push(ref)
    }
    this.progress('resolve', units.length, units.length)
  }
  /** 将未解决关系整理为公开诊断，并保存已校验的索引事实。 */
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
    this.repo.saveFacts(this.snapshot.snapshotId, this.indexes, this.references, [
      ...this.context!.evidence.values()
    ])
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
        .filter((c) => !this.partial.has(`index:${c.chunkId}`))
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
