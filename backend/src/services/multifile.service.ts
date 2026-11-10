import { randomUUID } from 'node:crypto'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import { createMultiFileGraph } from '../ai/graph/multifile.graph'
import { AnalysisBudget, runMultiFollowUp } from '../ai/chains/multifile.chain'
import { SourceRepository } from '../repositories/source.repository'
import { SessionRepository } from '../repositories/session.repository'
import { DraftSchema, type SourceFileInput } from '../domain/source/schema'
import { MultiFileFlowResultSchema, type MultiFileFlowResult } from '../domain/multifile/schema'
import { SourceContext } from './source-context.service'
import { RetrievalService } from './retrieval.service'
import { AnalysisRuntime } from './multifile-runtime'
import { withSessionLock, SessionError, isSessionBusy } from './session-lock'
import { coveredLines, normalizeSourcePath } from '../utils/sourcePositions'
import { chunkSource } from '../utils/sourceChunks'
import { chunkConfig, SOURCE_LIMITS } from './multifile-config'
import { z } from 'zod'
import { analysisTraceConfig, inheritTraceConfig, traceStep } from '../ai/observability/langsmith'

/** 用本次提交的草稿预览分块，按输入顺序返回文件和范围。 */
export async function previewChunks(input: SourceFileInput[]) {
  const config = chunkConfig()
  const files = SourceRepository.validateFiles(
    input,
    Number(process.env.CODE2FLOW_MULTI_MAX_FILES ?? 20),
    Number(process.env.CODE2FLOW_MULTI_MAX_TOTAL_BYTES ?? 2097152)
  )
  return {
    ...config,
    files: await Promise.all(files.map(async ({ path, content }, index) => {
      const chunks = await chunkSource(`preview_${index + 1}`, path, content, config)
      return {
        path,
        strategy: chunks[0]!.strategy,
        chunks: chunks.map((chunk) => ({
          ...coveredLines(chunk),
          chunkId: chunk.chunkId,
          chunkerVersion: chunk.chunkerVersion
        }))
      }
    }))
  }
}

/** 历史与新图的前端定位都使用包含首尾的原始行号。 */
function publicMapping(value: MultiFileFlowResult['mappings'][number]) {
  const { columnStart, columnEnd, startOffset, endOffset, ...mapping } = value
  return { ...mapping, ...coveredLines(value) }
}

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
        SourceRepository.validateFiles(
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
  /** 读取生成已保存的源码块，沿用快照正文和原始位置。 */
  snapshotChunks(id: string, snapshotId: string) {
    const snapshot = this.snapshot(id, snapshotId)
    const chunks = this.repo.chunks(snapshot)
    if (!chunks.length) return null
    const target = /^syntax-v3-.+-(\d+)-(?:lines|whole)$/.exec(chunks[0]!.chunkerVersion)?.[1]
    return {
      chunkTargetChars: target ? Number(target) : null,
      files: snapshot.files.map(({ fileId, path }) => {
        const items = chunks
          .filter((chunk) => chunk.fileId === fileId)
          .sort((a, b) => a.startOffset - b.startOffset)
        return {
          path,
          content: this.repo.content(snapshot, fileId),
          strategy: items[0]?.strategy ?? null,
          chunks: items.map(({ chunkId, chunkerVersion, startOffset, endOffset, ...range }) => ({
            ...coveredLines(range),
            chunkId,
            chunkerVersion,
            startOffset,
            endOffset
          }))
        }
      })
    }
  }
  /** 保存可编辑工作区，使用会话锁与 revision 防止旧草稿覆盖新内容。 */
  async saveDraft(id: string, input: z.infer<typeof DraftSchema>) {
    return withSessionLock(id, async () => {
      this.ensure(id)
      const files = input.files.length
        ? SourceRepository.validateFiles(
            input.files,
            Number(process.env.CODE2FLOW_MULTI_MAX_FILES ?? 20),
            Number(process.env.CODE2FLOW_MULTI_MAX_TOTAL_BYTES ?? 2097152)
          )
        : []
      const activePath = files.length ? normalizeSourcePath(input.activePath) : input.activePath
      if (files.length ? !files.some((f) => f.path === activePath) : activePath !== '')
        throw new SessionError('活动文件不存在，空工作区的活动路径必须为空。', 400)
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
    const result = state.values.result
    return {
      version: 2 as const,
      draft: this.repo.draft(id),
      sourceSnapshotId: snapshot?.snapshotId ?? null,
      snapshot,
      result: result ? { ...result, mappings: result.mappings.map(publicMapping) } : null,
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
    emit: (type: string, content?: unknown) => void
  ) {
    return withSessionLock(id, () =>
      traceStep(
        'code2flow.multifile',
        { sessionId: id, snapshotId },
        async () => {
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
          const failureController = new AbortController(),
            timeout = AbortSignal.timeout(Number(process.env.CODE2FLOW_MULTI_TIMEOUT_MS ?? 900000)),
            combined = AbortSignal.any([signal, timeout, failureController.signal])
          const runtime = new AnalysisRuntime(
            this.repo,
            snapshot,
            analysisId,
            combined,
            (metadata) => emit('metadata', metadata)
          )
          const graph = createMultiFileGraph(runtime, this.saver),
            config = inheritTraceConfig({
              ...this.config(id),
              signal: combined,
              runName: 'code2flow.multifile-graph',
              metadata: { analysis_id: analysisId, snapshot_id: snapshotId, session_id: id }
            })
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
                outcomes: {
                  __reset__: { taskId: '__reset__', attempts: 0, error: null, fatal: false }
                }
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
              stage: 'complete'
            })
            emit('mermaid', result.mermaid)
            emit('mappings', result.mappings.map(publicMapping))
            emit('done')
            return result
          } catch (error) {
            const wasAborted = combined.aborted
            // 一项任务不可继续时，停止同次分析仍在进行的模型和检索请求。
            failureController.abort()
            // 错误状态也使用官方图更新；取消后不提交迟到结果。
            await graph.updateState(
              this.config(id),
              {
                result: null,
                error: wasAborted ? '分析已取消或超时。' : '分析未完成，请检查诊断后重新生成。'
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
            throw error
          }
        },
        analysisTraceConfig('multifile', id, { snapshot_id: snapshotId })
      )
    )
  }
  /** 仅允许基于已有结果的同一快照追问，避免新源码与旧流程图混用。 */
  async followUp(id: string, snapshotId: string, question: string, signal: AbortSignal) {
    return withSessionLock(id, () =>
      traceStep(
        'code2flow.multifile-followup',
        { sessionId: id, snapshotId, question },
        async () => {
          const snapshot = this.snapshot(id, snapshotId),
            graph = createMultiFileGraph(undefined, this.saver),
            config = this.config(id),
            state = await graph.getState(config)
          if (state.values.snapshotId !== snapshotId || !state.values.result || state.values.error)
            throw new SessionError('追问必须基于已完成的同一快照。', 409)
          const draft = this.repo.draft(id)
          if (draft) {
            if (!draft.files.length) throw new SessionError('草稿已清空，请重新生成后追问。', 409)
            const files = SourceRepository.validateFiles(draft.files)
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
          const context = new SourceContext(
            this.repo,
            snapshot,
            chunks,
            indexes,
            combined,
            retrieval
          )
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
          return { thread_id: id, snapshotId, question, explanation }
        },
        analysisTraceConfig('multifile-followup', id, { snapshot_id: snapshotId })
      )
    )
  }
}
let instance: MultiFileService | undefined
export function getMultiFileService() {
  return (instance ??= new MultiFileService(getCodeFlowCheckpointer()))
}
export { SOURCE_LIMITS }
