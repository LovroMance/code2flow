import { randomUUID } from 'node:crypto'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import { createMultiFileGraph } from '../ai/graph/multifile.graph'
import { AnalysisBudget, runMultiFollowUp } from '../ai/chains/multifile.chain'
import { SourceRepository } from '../repositories/source.repository'
import { SessionRepository } from '../repositories/session.repository'
import { DraftSchema, type SourceFileInput } from '../domain/source/schema'
import { MultiFileFlowResultSchema } from '../domain/multifile/schema'
import { SourceContext } from './source-context.service'
import { RetrievalService } from './retrieval.service'
import { AnalysisRuntime } from './multifile-runtime'
import { withSessionLock, SessionError, isSessionBusy } from './session-lock'
import { normalizeSourcePath } from '../utils/sourcePositions'
import { SOURCE_LIMITS } from './multifile-config'
import { z } from 'zod'
import { recordMultiFileTrace } from '../ai/observability/multifile.trace'

export class MultiFileService {
  readonly repo: SourceRepository
  private readonly sessions: SessionRepository
  constructor(readonly saver: SqliteSaver) {
    this.repo = new SourceRepository(saver)
    this.sessions = new SessionRepository(saver)
  }
  private ensure(id: string) {
    if (!this.sessions.get(id) || this.sessions.wasDeleted(id))
      throw new SessionError('会话不存在或已删除。', 404)
  }
  private config(id: string) {
    return { configurable: { thread_id: this.repo.analysisThread(id)! }, recursionLimit: 1000 }
  }
  /** 校验并固定源码集合；后续生成只传 snapshotId，不再次接收可变正文。 */
  async createSnapshot(id: string, files: SourceFileInput[]) {
    return withSessionLock(id, async () => {
      this.ensure(id)
      return this.repo.create(
        id,
        this.repo.validateFiles(
          files,
          Number(process.env.CODE2FLOW_MULTI_MAX_FILES ?? 20),
          Number(process.env.CODE2FLOW_MULTI_MAX_TOTAL_BYTES ?? 2097152)
        )
      )
    })
  }
  snapshot(id: string, snapshotId: string) {
    this.ensure(id)
    return this.repo.get(id, snapshotId)
  }
  file(id: string, snapshotId: string, fileId: string) {
    const snapshot = this.snapshot(id, snapshotId)
    return { fileId, content: this.repo.content(snapshot, fileId) }
  }
  /** 保存可编辑工作区，使用会话锁与 revision 防止旧草稿覆盖新内容。 */
  async saveDraft(id: string, input: z.infer<typeof DraftSchema>) {
    return withSessionLock(id, async () => {
      this.ensure(id)
      const files = this.repo.validateFiles(
        input.files,
        Number(process.env.CODE2FLOW_MULTI_MAX_FILES ?? 20),
        Number(process.env.CODE2FLOW_MULTI_MAX_TOTAL_BYTES ?? 2097152)
      )
      const activePath = normalizeSourcePath(input.activePath)
      if (!files.some((f) => f.path === activePath)) throw new SessionError('活动文件不存在。', 400)
      const saved = this.repo.saveDraft(id, { ...input, activePath, files })
      this.sessions.save({ ...this.sessions.get(id)!, updatedAt: new Date().toISOString() })
      return saved
    })
  }
  /** 组合业务草稿/快照与官方图状态，恢复页面所需的数据。 */
  async detail(id: string) {
    this.ensure(id)
    const state = await createMultiFileGraph(undefined, this.saver).getState(this.config(id))
    const snapshot = state.values.snapshotId ? this.repo.get(id, state.values.snapshotId) : null
    return {
      version: 2 as const,
      draft: this.repo.draft(id),
      sourceSnapshotId: snapshot?.snapshotId ?? null,
      snapshot,
      result: state.values.result ?? null,
      messages: state.values.messages ?? [],
      failed: !!state.values.error || (!!state.values.snapshotId && !state.values.result),
      busy: isSessionBusy(id)
    }
  }
  /** 管理生成的锁、取消、超时及 SSE；具体阶段由 graph 编排，runtime 实现。 */
  async generate(
    id: string,
    snapshotId: string,
    signal: AbortSignal,
    emit: (type: string, content?: unknown) => void,
    source: 'online' | 'eval' = 'online'
  ) {
    return withSessionLock(id, async () => {
      const snapshot = this.snapshot(id, snapshotId),
        analysisId = randomUUID()
      const baseGraph = createMultiFileGraph(undefined, this.saver)
      await baseGraph.updateState(
        this.config(id),
        { snapshotId, analysisId, result: null, error: '分析尚未完成。', messages: [] },
        'validateResult'
      )
      emit('metadata', {
        version: 2,
        snapshotId,
        analysisId,
        stage: 'prepare',
        detectedLanguage: snapshot.languageDetection?.language ?? 'unknown'
      })
      const timeout = AbortSignal.timeout(Number(process.env.CODE2FLOW_MULTI_TIMEOUT_MS ?? 900000)),
        combined = AbortSignal.any([signal, timeout])
      const runtime = new AnalysisRuntime(this.repo, snapshot, analysisId, combined, (metadata) =>
        emit('metadata', metadata)
      )
      const graph = createMultiFileGraph(runtime, this.saver),
        config = { ...this.config(id), signal: combined }
      try {
        // 官方 saver 保存最终图与对话，正文只保存在业务表。
        const state = await graph.invoke(
          {
            snapshotId,
            analysisId,
            result: null,
            error: null,
            messages: [],
            pending: [],
            batch: [],
            stage: 'index',
            coverage: null,
            languageDetection: snapshot.languageDetection,
            outcomes: { __reset__: { taskId: '__reset__', attempts: 0, error: null, fatal: false } }
          },
          config
        )
        combined.throwIfAborted()
        const result = MultiFileFlowResultSchema.parse(state.result)
        this.sessions.save({ ...this.sessions.get(id)!, updatedAt: new Date().toISOString() })
        emit('metadata', {
          ...result,
          mermaid: undefined,
          mappings: undefined,
          stage: 'complete',
          usage: runtime.budget()
        })
        emit('mermaid', result.mermaid)
        emit('mappings', result.mappings)
        emit('done')
        await recordMultiFileTrace({
          analysisId,
          snapshotId,
          sessionId: id,
          operation: 'multifile',
          source,
          outcome: 'success',
          metrics: {
            ...runtime.budget(),
            coverage: runtime.coverage(),
            diagnostics: runtime.diagnostics.map(({ code, fileId }) => ({ code, fileId }))
          }
        })
        return result
      } catch (error) {
        // 错误状态也使用官方图更新；取消后不提交迟到结果。
        await graph.updateState(
          this.config(id),
          {
            result: null,
            error: combined.aborted ? '分析已取消或超时。' : '分析未完成，请检查诊断后重新生成。'
          },
          'validateResult'
        )
        emit('metadata', {
          version: 2,
          snapshotId,
          analysisId,
          stage: 'incomplete',
          detectedLanguage: snapshot.languageDetection?.language ?? 'unknown',
          coverage: runtime.coverage(),
          missingRanges: runtime.incompleteRanges().slice(0, 200)
        })
        await recordMultiFileTrace({
          analysisId,
          snapshotId,
          sessionId: id,
          operation: 'multifile',
          source,
          outcome: 'error',
          metrics: {
            ...runtime.budget(),
            coverage: runtime.coverage(),
            diagnostics: runtime.diagnostics.map(({ code, fileId }) => ({ code, fileId }))
          }
        })
        throw error
      }
    })
  }
  /** 仅允许基于已有结果的同一快照追问，避免新源码与旧流程图混用。 */
  async followUp(id: string, snapshotId: string, question: string, signal: AbortSignal) {
    return withSessionLock(id, async () => {
      const snapshot = this.snapshot(id, snapshotId),
        graph = createMultiFileGraph(undefined, this.saver),
        config = this.config(id),
        state = await graph.getState(config)
      if (state.values.snapshotId !== snapshotId || !state.values.result || state.values.error)
        throw new SessionError('追问必须基于已完成的同一快照。', 409)
      const draft = this.repo.draft(id)
      if (draft) {
        const files = this.repo.validateFiles(draft.files)
        if (
          files.length !== snapshot.files.length ||
          files.some((f) => {
            const old = snapshot.files.find((s) => s.path === f.path)
            return !old || this.repo.content(snapshot, old.fileId) !== f.content
          })
        )
          throw new SessionError('草稿已修改，请重新生成后追问。', 409)
      }
      const combined = AbortSignal.any([
        signal,
        AbortSignal.timeout(Number(process.env.CODE2FLOW_MULTI_TIMEOUT_MS ?? 900000))
      ])
      const budget = new AnalysisBudget(combined),
        chunks = this.repo.chunks(snapshot)
      const retrieval = new RetrievalService(
        this.repo,
        snapshot,
        chunks,
        combined,
        budget.config.concurrency
      )
      await retrieval.prepare()
      const indexes = this.repo.indexes(snapshot)
      retrieval.setIndexes(indexes)
      const context = new SourceContext(this.repo, snapshot, chunks, indexes, combined, retrieval)
      let outcome: 'success' | 'error' = 'error'
      try {
        const explanation = await runMultiFollowUp(
          question,
          { result: state.values.result, messages: state.values.messages },
          context,
          budget
        )
        combined.throwIfAborted()
        await graph.updateState(
          config,
          {
            messages: [
              ...state.values.messages,
              { role: 'user', content: question },
              { role: 'assistant', content: explanation }
            ]
          },
          'validateResult'
        )
        outcome = 'success'
        return { thread_id: id, snapshotId, question, explanation }
      } finally {
        await recordMultiFileTrace({
          analysisId: state.values.analysisId,
          snapshotId,
          sessionId: id,
          operation: 'multifile-followup',
          outcome,
          source: 'online',
          metrics: {
            ...budget.summary(),
            readChars: context.charsRead,
            embedding: { calls: retrieval.embeddingCalls, ...retrieval.embeddingUsage }
          }
        })
      }
    })
  }
}
let instance: MultiFileService | undefined
export function getMultiFileService() {
  return (instance ??= new MultiFileService(getCodeFlowCheckpointer()))
}
export { SOURCE_LIMITS }
