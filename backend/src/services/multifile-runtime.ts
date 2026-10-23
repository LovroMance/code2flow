import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AnalysisBudget,
  AnalysisLimitError,
  ModelConfigurationError,
  runMultiFileChain
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
import type { CodeChunk, SourceSnapshot } from '../domain/source/schema'
import { EvidenceSchema } from '../domain/source/schema'
import { SourceContext } from './source-context.service'
import { RetrievalService } from './retrieval.service'
import { referenceCandidates, validateResolvedReference } from './reference-resolution.service'
import type { SourceRepository } from '../repositories/source.repository'
import {
  languageSample,
  missingRanges,
  sha256,
  validateSourceRange
} from '../utils/sourcePositions'
import { composeMultiFileFlow, validateUnitDraft } from '../utils/composeMultiFileFlow'
import { mergeFileFragments, FragmentConflictError } from '../utils/mergeFileFragments'
import { safeErrorDetails } from '../ai/observability/safe-error'

const CachedIndexSchema = z.object({
  index: FileSemanticIndexSchema,
  evidence: z.array(EvidenceSchema)
})
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
  readonly references: CrossFileReference[] = []
  readonly diagnostics: PublicDiagnostic[] = []
  retrieval?: RetrievalService
  context?: SourceContext
  private candidates: ReturnType<typeof referenceCandidates> = []
  private readonly verificationBatches = new Map<string, CrossFileReference[]>()
  private readonly startedAt = Date.now()
  private lastStage = 'prepare'
  private stageStarted = Date.now()
  readonly stageDurations: Record<string, number> = {}
  jevDurationMs = 0
  jevUsage: Record<string, number> = {}
  private verifyChars = 0
  constructor(
    readonly repo: SourceRepository,
    readonly snapshot: SourceSnapshot,
    readonly analysisId: string,
    readonly signal: AbortSignal,
    private readonly emit: (metadata: Record<string, unknown>) => void
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
      (process.env.DEEPSEEK_MODEL !== undefined && !process.env.DEEPSEEK_MODEL.trim()) ||
      !Number.isFinite(Number(process.env.DEEPSEEK_TEMPERATURE ?? 0))
    )
      throw new ModelConfigurationError('生成模型密钥、模型名称或温度配置无效。')
    try {
      const url = new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com')
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      throw new ModelConfigurationError('生成模型端点配置无效。')
    }
    this.progress('prepare', 0, this.snapshot.files.length)
  }
  /** 同一快照只检测一次语言；已有 unknown 也复用，生成角色不能改写检测结果。 */
  async detect() {
    this.progress('detect', 0, 1)
    const started = Date.now()
    if (!this.snapshot.languageDetection) {
      this.snapshot.languageDetection = await runDetectLanguage(
        languageSample(
          this.snapshot.files.map((f) => ({
            path: f.path,
            content: this.repo.content(this.snapshot, f.fileId)
          }))
        ),
        this.signal,
        (info) => {
          this.jevUsage = info.usage
        }
      )
      this.signal.throwIfAborted()
      this.repo.saveDetection(this.snapshot)
    }
    this.jevDurationMs = Date.now() - started
    this.progress('detect', 1, 1)
    return this.snapshot.languageDetection
  }
  /** 为全部文件建立保留原始位置的分块，并准备检索；不按搜索排名裁剪分析范围。 */
  async basic() {
    this.signal.throwIfAborted()
    this.progress('basic', 0, this.snapshot.files.length)
    const maxChars = Math.min(
      8000,
      Math.max(500, Math.floor((this.budgetTracker.config.contextTokens - 16000) / 3))
    )
    this.chunks = this.repo.basicChunks(this.snapshot, maxChars)
    this.repo.saveChunks(this.snapshot, this.chunks)
    this.retrieval = new RetrievalService(
      this.repo,
      this.snapshot,
      this.chunks,
      this.signal,
      this.concurrency
    )
    await this.retrieval.prepare()
    this.diagnostics.push(...this.retrieval.diagnostics)
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
  /** 将边界冲突或阻塞缺口定位回相关索引任务，供图执行有界重试。 */
  repairIndexes(error?: unknown) {
    const ranges =
      error instanceof FragmentConflictError ? [error.range] : this.coverage().unresolvedRanges
    if (error && !(error instanceof FragmentConflictError)) throw error
    const tasks = this.chunks
      .filter((chunk) =>
        ranges.some(
          (range) =>
            range.fileId === chunk.fileId &&
            range.startOffset < chunk.endOffset &&
            range.endOffset > chunk.startOffset
        )
      )
      .map((chunk) => {
        return `index:${chunk.chunkId}`
      })
    return tasks
  }
  verificationTasks() {
    return [...this.verificationBatches.keys()]
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
        version: 'index-v2.5'
      })
    )
  }
  /** 检查任务归属、范围和证据；schema 合法并不代表模型真的读过对应源码。 */
  private checkIndex(index: FileSemanticIndex, chunk: CodeChunk, context: SourceContext) {
    if (index.fileId !== chunk.fileId) throw new Error('分块文件身份错误。')
    if (
      missingRanges(
        chunk.endOffset - chunk.startOffset,
        index.analyzedRanges.map((r) => {
          if (
            r.startOffset < chunk.startOffset ||
            r.endOffset > chunk.endOffset ||
            r.endOffset <= r.startOffset
          )
            throw new Error('analyzedRanges超出任务范围。')
          return {
            startOffset: r.startOffset - chunk.startOffset,
            endOffset: r.endOffset - chunk.startOffset
          }
        })
      ).length
    )
      throw new Error('分配的源码块没有完整处理。')
    const ids = new Set<string>(),
      calls = new Set<string>()
    for (const unit of index.units) {
      if (unit.complete !== (unit.boundary.startKnown && unit.boundary.endKnown))
        throw new Error('单元完整状态与边界标记不一致。')
      if (ids.has(unit.unitId)) throw new Error('临时单元ID重复。')
      ids.add(unit.unitId)
      if (unit.range.fileId !== index.fileId) throw new Error('单元跨文件。')
      context.validate(unit.range, unit.evidenceIds)
      for (const control of unit.controlRanges) {
        context.validate(control.range, unit.evidenceIds)
        if (
          control.range.startOffset < unit.range.startOffset ||
          control.range.endOffset > unit.range.endOffset
        )
          throw new Error('控制位置超出单元。')
      }
      for (const [callIndex, call] of unit.callSites.entries()) {
        context.validate(call.range, call.evidenceIds)
        const source = this.repo
          .content(this.snapshot, call.range.fileId)
          .slice(call.range.startOffset, call.range.endOffset)
        if (!source.includes(call.text) || !source.includes(call.targetHint)) {
          console.log('[code-flow][v2] index-call-invalid', {
            ...context.logContext,
            unitIndex: index.units.indexOf(unit),
            callIndex,
            startOffset: call.range.startOffset,
            endOffset: call.range.endOffset,
            lineStart: call.range.lineStart,
            lineEnd: call.range.lineEnd,
            textMatches: source.includes(call.text),
            targetMatches: source.includes(call.targetHint),
            textLength: call.text.length,
            rangeLength: source.length
          })
          throw new Error(
            `调用点units[${index.units.indexOf(unit)}].callSites[${callIndex}]的text或targetHint不在其range中；请核对该调用点的行号和范围，text填写原始调用源码，不能写解释、添加分号或改写空格。`
          )
        }
        if (calls.has(call.callSiteId)) throw new Error('调用点ID重复。')
        calls.add(call.callSiteId)
        if (
          call.range.startOffset < unit.range.startOffset ||
          call.range.endOffset > unit.range.endOffset
        )
          throw new Error('调用点超出单元。')
      }
    }
    for (const ref of index.references) context.validate(ref.range, ref.evidenceIds)
    for (const item of index.unresolvedItems)
      validateSourceRange(item.range, index.fileId, this.repo.content(this.snapshot, index.fileId))
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
    return FileSemanticIndexSchema.parse(rewrite(cached.index))
  }
  /** 按任务前缀执行索引、核对或生成；返回安全的失败反馈，由 graph 决定是否重试。 */
  async task(id: string, attempts: number, feedback: string | null): Promise<TaskOutcome> {
    let cacheKey: string | undefined
    console.log('[code-flow][v2] task-start', { taskId: id, attempt: attempts })
    try {
      this.signal.throwIfAborted()
      if (id.startsWith('index:')) {
        const chunk = this.chunks.find((c) => `index:${c.chunkId}` === id)!
        const context = new SourceContext(
          this.repo,
          this.snapshot,
          this.chunks,
          [],
          this.signal,
          this.retrieval
        )
        context.allowedFileId = chunk.fileId
        context.logContext = { analysisId: this.analysisId, taskId: id, attempt: attempts }
        console.log('[code-flow][v2] index-input', {
          ...context.logContext,
          snapshotId: this.snapshot.snapshotId,
          fileId: chunk.fileId,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          hasFeedback: feedback !== null
        })
        cacheKey = this.key(chunk)
        const cached = CachedIndexSchema.safeParse(
          feedback ? undefined : this.repo.cacheGet(this.snapshot.sessionId, cacheKey)
        )
        let index: FileSemanticIndex
        if (cached.success) {
          index = this.rebind(cached.data, chunk, context)
          this.budgetTracker.cacheHits++
        } else {
          const code = context.read(chunk.fileId, chunk.startOffset, chunk.endOffset)
          index = await runMultiFileChain(
            'index',
            {
              file: this.snapshot.files.find((f) => f.fileId === chunk.fileId),
              taskRange: chunk,
              code
            },
            context,
            this.snapshot.languageDetection!.language,
            this.budgetTracker,
            feedback ?? undefined
          )
        }
        this.checkIndex(index, chunk, context)
        console.log('[code-flow][v2] index-validated', {
          ...context.logContext,
          unitCount: index.units.length,
          referenceCount: index.references.length,
          unresolvedCount: index.unresolvedItems.length,
          readCalls: context.readCalls,
          charsRead: context.charsRead
        })
        // 只允许本文件补读，禁止把外部上下文错误当作可移植缓存。
        if ([...context.evidence.values()].some((e) => e.fileId !== chunk.fileId))
          throw new Error('文件Worker只能读取本文件上下文。')
        this.signal.throwIfAborted()
        this.repo.cachePut(this.snapshot.sessionId, this.key(chunk), {
          index,
          evidence: [...context.evidence.values()]
        })
        this.partial.set(id, index)
        this.contexts.set(id, context)
        this.repo.task(this.snapshot, id, attempts, 'complete', {
          index,
          evidence: [...context.evidence.values()]
        })
      } else if (id.startsWith('verify:')) {
        await this.verify(this.verificationBatches.get(id)!, feedback ?? undefined)
        this.repo.task(this.snapshot, id, attempts, 'complete', {
          referenceIds: this.verificationBatches.get(id)!.map((r) => r.referenceId)
        })
      } else {
        const unit = this.indexes
          .flatMap((i) => i.units)
          .find((u) => `generate:${u.unitId}` === id)!
        const context = this.context!
        const code = context.read(unit.range.fileId, unit.range.startOffset, unit.range.endOffset)
        const payload = {
          unit,
          code,
          relatedReferences: this.references.filter((r) => r.sourceUnitId === unit.unitId),
          unresolved: this.indexes.find((i) => i.fileId === unit.range.fileId)!.unresolvedItems
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
            version: 'flow-v2.4'
          })
        )
        cacheKey = key
        // 局部缓存只在同一快照身份下重用；所有证据重新登记，不能复用旧evidenceId。
        const cached = this.repo.cacheGet(this.snapshot.sessionId, key)
        let draft: UnitFlowDraft
        if (cached) {
          const old = UnitFlowDraftSchema.parse(cached)
          draft = {
            ...old,
            nodes: old.nodes.map((node) => ({ ...node, evidenceIds: [code.evidence.evidenceId] }))
          }
          this.budgetTracker.cacheHits++
        } else
          draft = await runMultiFileChain(
            'generate',
            payload,
            context,
            this.snapshot.languageDetection!.language,
            this.budgetTracker,
            feedback ?? undefined
          )
        if (draft.unitId !== unit.unitId) throw new Error('返回了其他执行单元。')
        validateUnitDraft(draft, context)
        // 生成 chain 仅能引用实际进入本次证据包的源码。
        for (const node of draft.nodes)
          if (
            node.evidenceIds.some(
              (e) => e !== code.evidence.evidenceId && !unit.evidenceIds.includes(e)
            )
          )
            throw new Error('生成引用了未提供的证据。')
        const expected = unit.callSites.filter((call) =>
          this.references.some((r) => r.callSiteId === call.callSiteId && r.status === 'resolved')
        )
        if (
          expected.some(
            (call) => !draft.nodes.some((node) => node.callSiteIds.includes(call.callSiteId))
          )
        )
          throw new Error('已确认调用点没有映射到节点。')
        this.signal.throwIfAborted()
        this.drafts.set(unit.unitId, draft)
        this.repo.cachePut(this.snapshot.sessionId, key, draft)
        this.repo.task(this.snapshot, id, attempts, 'complete', { unitId: unit.unitId })
      }
      console.log('[code-flow][v2] task-complete', { taskId: id, attempt: attempts })
      return { taskId: id, attempts, error: null, fatal: false }
    } catch (error) {
      this.signal.throwIfAborted()
      if (cacheKey) this.repo.cacheDelete(this.snapshot.sessionId, cacheKey)
      // 不持久化供应商原始异常，避免请求正文或密钥进入任务记录。
      const safe =
        error instanceof z.ZodError
          ? `结构化字段不符合schema，请按工具契约修正：${JSON.stringify(safeErrorDetails(error).issues ?? [])}`
          : error instanceof AnalysisLimitError || error instanceof ModelConfigurationError
            ? error.message
            : error instanceof Error &&
                /^(分块|分配|临时|调用|单元|控制|文件Worker|生成引用|已确认|返回了|节点|局部|源码|引用了|analyzedRanges)/.test(
                  error.message
                )
              ? error.message
              : '模型请求或结构校验失败，请核对任务范围与提交字段。'
      console.log('[code-flow][v2] task-failed', {
        taskId: id,
        attempt: attempts,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        analysisId: this.analysisId,
        snapshotId: this.snapshot.snapshotId,
        error: JSON.stringify(safeErrorDetails(error)),
        diagnostic: safe
      })
      this.repo.task(this.snapshot, id, attempts, 'failed', { diagnostic: safe })
      return {
        taskId: id,
        attempts,
        error: safe,
        fatal: error instanceof AnalysisLimitError || error instanceof ModelConfigurationError
      }
    }
  }
  /** 合并各块的重叠片段，建立正式单元/调用点身份，再汇总文件索引与证据。 */
  merge() {
    const units = new Map<string, ExecutionUnit>()
    this.context = new SourceContext(
      this.repo,
      this.snapshot,
      this.chunks,
      this.indexes,
      this.signal,
      this.retrieval
    )
    for (const context of this.contexts.values())
      for (const [id, e] of context.evidence) {
        this.context.evidence.set(id, e)
        this.context.accessible.add(id)
      }
    this.indexes = this.snapshot.files.map((file) => {
      const parts = mergeFileFragments(
        file.fileId,
        this.repo.content(this.snapshot, file.fileId),
        [...this.partial.values()].filter((i) => i.fileId === file.fileId)
      )
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
            old.evidenceIds = [...new Set([...old.evidenceIds, ...unit.evidenceIds])]
            old.controlRanges = [
              ...new Map(
                [...old.controlRanges, ...unit.controlRanges].map((c) => [
                  JSON.stringify(c.range),
                  c
                ])
              ).values()
            ]
            old.callSites = [
              ...new Map(
                [...old.callSites, ...unit.callSites].map((c) => [
                  `${c.range.startOffset}:${c.range.endOffset}:${c.targetHint}`,
                  c
                ])
              ).values()
            ]
          } else units.set(key, { ...unit, unitId: `u_${sha256(key).slice(0, 20)}` })
        }
        references.push(...part.references)
      }
      const fileUnits = [...units.values()].filter((u) => u.range.fileId === file.fileId)
      for (const unit of fileUnits)
        unit.callSites = unit.callSites.map((c) => ({
          ...c,
          callSiteId: `call_${sha256(`${unit.unitId}:${c.range.startOffset}:${c.range.endOffset}`).slice(0, 20)}`
        }))
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
        unresolvedItems: parts.flatMap((i) => i.unresolvedItems),
        status: parts[0]!.status,
        schemaVersion: '2' as const
      }
    })
    // 拒绝同作用域、同起点但结束冲突的单元；嵌套范围仍然合法。
    for (const index of this.indexes)
      for (const unit of index.units)
        if (
          index.units.some(
            (other) =>
              other !== unit &&
              other.range.startOffset === unit.range.startOffset &&
              other.scope === unit.scope &&
              other.name === unit.name &&
              other.range.endOffset !== unit.range.endOffset
          )
        )
          throw new FragmentConflictError(unit.range)
    this.context = new SourceContext(
      this.repo,
      this.snapshot,
      this.chunks,
      this.indexes,
      this.signal,
      this.retrieval
    )
    for (const context of this.contexts.values())
      for (const [id, e] of context.evidence) {
        this.context.evidence.set(id, e)
        this.context.accessible.add(id)
      }
    this.retrieval?.setIndexes(this.indexes)
    this.repo.saveFacts(
      this.snapshot.snapshotId,
      this.indexes,
      [],
      [...this.context.evidence.values()]
    )
  }
  /** 程序先找结构候选，再为需要核对的关系建立模型任务；检索命中不等于确认调用。 */
  async resolve() {
    this.references.length = 0
    this.verificationBatches.clear()
    this.progress('resolve', 0, this.indexes.flatMap((i) => i.units).length)
    this.candidates = referenceCandidates(this.snapshot, this.indexes)
    for (const { unit, call, candidates, imports, scopeEvidence } of this.candidates) {
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
          validateResolvedReference(
            ref,
            this.context!,
            this.indexes.flatMap((i) => i.units)
          )
        } catch {
          ref.status = 'unresolved'
          ref.targetUnitId = undefined
          ref.diagnostic = '候选目标尚未具备完整绑定证据。'
        }
      }
      this.references.push(ref)
    }
    const unresolved = this.references.filter(
      (r) =>
        r.status !== 'resolved' &&
        this.candidates.find((c) => c.call.callSiteId === r.callSiteId)!.unit.complete &&
        this.candidates
          .find((c) => c.call.callSiteId === r.callSiteId)!
          .candidates.every((unit) => unit.complete) &&
        this.candidates.find((c) => c.call.callSiteId === r.callSiteId)!.candidates.length > 0
    )
    for (let offset = 0; offset < unresolved.length; offset += 4)
      this.verificationBatches.set(`verify:${offset / 4}`, unresolved.slice(offset, offset + 4))
    this.progress('verify', 0, this.verificationBatches.size)
  }
  /** 核对角色可补读跨文件源码，提交后仍需通过候选身份及原始证据校验。 */
  private async verify(batch: CrossFileReference[], feedback?: string) {
    const facts = batch.map((ref) => {
      const c = this.candidates.find((c) => c.call.callSiteId === ref.callSiteId)!
      return {
        reference: ref,
        source: c.unit,
        call: c.call,
        candidates: c.candidates,
        imports: c.imports
      }
    })
    const context = new SourceContext(
      this.repo,
      this.snapshot,
      this.chunks,
      this.indexes,
      this.signal,
      this.retrieval
    )
    const evidence = facts.flatMap((f) => [
      context.read(f.call.range.fileId, f.call.range.startOffset, f.call.range.endOffset),
      ...f.imports.map((r) => context.read(r.range.fileId, r.range.startOffset, r.range.endOffset))
    ])
    // 歧义候选先由简单RAG召回，定点读取仍由Worker完成，相似度不能确认目标。
    const search = await Promise.all(
      facts.map((f) => this.retrieval!.search(f.call.targetHint, 'hybrid'))
    )
    const checked = await runMultiFileChain(
      'verify',
      { facts, evidence, search },
      context,
      this.snapshot.languageDetection!.language,
      this.budgetTracker,
      feedback
    )
    for (const ref of checked.references) {
      const old = batch.find((r) => r.referenceId === ref.referenceId)
      if (!old || ref.sourceUnitId !== old.sourceUnitId || ref.callSiteId !== old.callSiteId)
        throw new Error('关系核对更改了候选身份。')
      validateResolvedReference(
        ref,
        context,
        this.indexes.flatMap((i) => i.units)
      )
      Object.assign(old, ref)
    }
    for (const [id, e] of context.evidence) {
      this.context!.evidence.set(id, e)
      this.context!.accessible.add(id)
    }
    this.verifyChars += context.charsRead
  }
  /** 将未解决关系和检索降级整理为公开诊断，并保存已校验的索引事实。 */
  finishReferences() {
    for (const index of this.indexes)
      for (const item of index.unresolvedItems)
        this.diagnostics.push({
          code: 'unresolved_semantics',
          message: item.description,
          fileId: index.fileId,
          range: item.range
        })
    for (const diagnostic of this.retrieval?.diagnostics ?? [])
      if (!this.diagnostics.some((d) => d.code === diagnostic.code))
        this.diagnostics.push(diagnostic)
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
  /** 对已分析偏移求并集，并检查边界与阻塞项；不把重叠读取重复算作覆盖。 */
  coverage() {
    const files = this.snapshot.files.map((f) => {
      const length = this.repo.content(this.snapshot, f.fileId).length,
        ranges =
          this.indexes.find((i) => i.fileId === f.fileId)?.analyzedRanges ??
          [...this.partial.values()]
            .filter((i) => i.fileId === f.fileId)
            .flatMap((i) => i.analyzedRanges),
        missing = missingRanges(length, ranges)
      return {
        fileId: f.fileId,
        total: length,
        covered: length - missing.reduce((n, r) => n + r.endOffset - r.startOffset, 0),
        missing
      }
    })
    const unresolvedRanges = this.indexes.flatMap((index) => [
      ...index.units.filter((unit) => !unit.complete).map((unit) => unit.range),
      ...index.unresolvedItems.filter((item) => item.blocking).map((item) => item.range)
    ])
    return {
      complete: files.every((f) => !f.missing.length) && !unresolvedRanges.length,
      files,
      unresolvedRanges
    }
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
  /** 最终提交门槛：必需任务全部完成，且每个映射仍有当前快照的有效证据。 */
  validate(result: ReturnType<AnalysisRuntime['compose']>) {
    this.signal.throwIfAborted()
    if (!result.coverage.complete || this.drafts.size !== this.generationTasks().length)
      throw new Error('必需任务未全部完成。')
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
          startOffset: c.startOffset,
          endOffset: c.endOffset
        })),
      ...this.indexes
        .flatMap((i) => i.units)
        .filter((u) => !this.drafts.has(u.unitId))
        .map((u) => ({
          phase: u.complete ? 'generate' : 'index',
          fileId: u.range.fileId,
          path: this.snapshot.files.find((f) => f.fileId === u.range.fileId)!.path,
          startOffset: u.range.startOffset,
          endOffset: u.range.endOffset
        }))
    ]
  }
  progress(stage: string, completed: number, total: number) {
    this.signal.throwIfAborted()
    if (stage !== this.lastStage) {
      this.stageDurations[this.lastStage] =
        (this.stageDurations[this.lastStage] ?? 0) + Date.now() - this.stageStarted
      this.lastStage = stage
      this.stageStarted = Date.now()
    }
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
  budget() {
    const readChars =
      [...this.contexts.values()].reduce((n, c) => n + c.charsRead, 0) +
      (this.context?.charsRead ?? 0) +
      this.verifyChars
    const evidence = this.context
      ? [...this.context.evidence.values()]
      : [...this.contexts.values()].flatMap((c) => [...c.evidence.values()])
    const uniqueReadChars = this.snapshot.files.reduce((sum, file) => {
      const length = this.repo.content(this.snapshot, file.fileId).length
      return (
        sum +
        length -
        missingRanges(
          length,
          evidence.filter((e) => e.fileId === file.fileId)
        ).reduce((n, r) => n + r.endOffset - r.startOffset, 0)
      )
    }, 0)
    return {
      ...this.budgetTracker.summary(),
      durationMs: Date.now() - this.startedAt,
      stageDurations: this.stageDurations,
      jev: {
        durationMs: this.jevDurationMs,
        model: process.env.TYPESAFE_DEFAULT_MODEL ?? 'jev-1.14.0',
        status: this.snapshot.languageDetection?.status ?? 'pending',
        usage: this.jevUsage
      },
      embedding: { calls: this.retrieval?.embeddingCalls ?? 0, ...this.retrieval?.embeddingUsage },
      readChars,
      uniqueReadChars,
      duplicateReadRatio: readChars ? Math.max(0, 1 - uniqueReadChars / readChars) : 0
    }
  }
}
