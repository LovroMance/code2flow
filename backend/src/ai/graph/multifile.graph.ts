import { END, START, Send, StateGraph, StateSchema, ReducedValue } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { z } from 'zod'
import { LanguageDetectionSchema } from '../../domain/flow/schema'
import { MultiFileFlowResultSchema, CoverageSchema } from '../../domain/multifile/schema'
import type { SourceRange } from '../../domain/source/schema'

/** 单个任务本轮结果；error 为 null 表示成功。不可重试的错误直接抛出。 */
export const TaskOutcomeSchema = z.object({
  // 与 pending 中的调度身份一致。
  taskId: z.string(),
  // 累计执行次数，包括第一次调用。
  attempts: z.number().int(),
  // 下一轮传给同角色的安全校验反馈。
  error: z.string().nullable()
})
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>
export function mergeTaskOutcomes(
  current: Record<string, TaskOutcome>,
  next: Record<string, TaskOutcome>
) {
  return '__reset__' in next ? {} : { ...current, ...next }
}
/** 官方 checkpointer 保存的调度状态；源码正文及索引明细保存在业务表中。 */
export const MultiFileState = new StateSchema({
  // 绑定不可变源码集合，重新生成时清空旧结果与问答。
  snapshotId: z.string().default(''),
  // 程序调用 Jev 得到的语言，后续所有角色共用。
  languageDetection: LanguageDetectionSchema.nullable().default(null),
  // 未完成任务、当前并发批次、Send 分支当前任务。
  pending: z.array(z.string()).default([]),
  batch: z.array(z.string()).default([]),
  taskId: z.string().default(''),
  // 并行分支按 taskId 合并，不能用数组追加而重复累计重试结果。
  outcomes: new ReducedValue(z.record(z.string(), TaskOutcomeSchema).default({}), {
    reducer: mergeTaskOutcomes
  }),
  // 组图并校验成功后保存整图；失败时不保留可用旧图。
  result: MultiFileFlowResultSchema.nullable().default(null),
  // 仅保存用户问题和对外解释，不保存模型内部推理。
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .default([]),
  // 供会话恢复判断上次分析是否失败。
  error: z.string().nullable().default(null)
})
export type MultiState = typeof MultiFileState.State
export interface MultiFileRuntime {
  prepare(): Promise<void>
  detect(): Promise<z.infer<typeof LanguageDetectionSchema>>
  basic(): Promise<void>
  indexTasks(): string[]
  generationTasks(): string[]
  concurrency: number
  retries: number
  task(id: string, attempt: number, feedback: string | null): Promise<TaskOutcome>
  merge(): void
  blockingIndexTasks(ranges: SourceRange[]): string[]
  resolve(): void
  finishReferences(): void
  coverage(): z.infer<typeof CoverageSchema>
  compose(): z.infer<typeof MultiFileFlowResultSchema>
  validate(result: z.infer<typeof MultiFileFlowResultSchema>): void
  progress(stage: string, completed: number, total: number): void
}

// Send 仅调度有界批次，输出按 taskId 合并；失败任务通过条件边重新进入原角色。
export function createMultiFileGraph(
  runtime: MultiFileRuntime | undefined,
  saver: BaseCheckpointSaver
) {
  const r = () => {
    if (!runtime) throw new Error('缺少执行上下文。')
    return runtime
  }
  return new StateGraph(MultiFileState)
    .addNode('prepareAnalysis', async () => {
      await r().prepare()
      return { result: null, messages: [], error: null }
    })
    .addNode('detectLanguage', async () => {
      return { languageDetection: await r().detect() }
    })
    .addNode('buildBasicIndex', async () => {
      await r().basic()
      return { pending: r().indexTasks() }
    })
    .addNode('planIndexBatch', (state) => {
      return { batch: state.pending.slice(0, r().concurrency) }
    })
    .addNode('indexFile', async (state) => {
      return {
        outcomes: {
          [state.taskId]: await r().task(
            state.taskId,
            (state.outcomes[state.taskId]?.attempts ?? 0) + 1,
            state.outcomes[state.taskId]?.error ?? null
          )
        }
      }
    })
    .addNode('mergeIndexes', (state) => {
      const pending = state.pending.filter(
        (id) => !state.batch.includes(id) || state.outcomes[id]?.error
      )
      const failure = state.batch
        .map((id) => state.outcomes[id])
        .find((outcome) => outcome?.error && outcome.attempts > r().retries)
      r().progress('index', r().indexTasks().length - pending.length, r().indexTasks().length)
      if (failure) throw new Error(`文件索引未完成：${failure.taskId}；${failure.error}`)
      if (!pending.length) r().merge()
      return { pending }
    })
    .addNode('resolveReferences', () => {
      r().resolve()
      return { pending: [] }
    })
    .addNode('assessCoverage', (state) => {
      const coverage = r().coverage()
      if (!coverage.complete) {
        const repair = r().blockingIndexTasks(coverage.unresolvedRanges ?? [])
        if (
          repair.length &&
          repair.every((id) => (state.outcomes[id]?.attempts ?? 0) <= r().retries)
        )
          return {
            pending: repair,
            outcomes: Object.fromEntries(
              repair.map((id) => [
                id,
                {
                  ...state.outcomes[id]!,
                  error: '此块存在影响生成的未解决问题，请核对本块源码并修正索引。'
                }
              ])
            )
          }
        throw new Error(
          `存在未解决的阻塞问题：${JSON.stringify({ unresolvedRanges: coverage.unresolvedRanges })}`
        )
      }
      r().finishReferences()
      return { pending: [] }
    })
    .addNode('buildGenerationTasks', () => {
      const pending = r().generationTasks()
      r().progress('generate', 0, pending.length)
      return { pending }
    })
    .addNode('planGenerationBatch', (state) => {
      return { batch: state.pending.slice(0, r().concurrency) }
    })
    .addNode('generateUnit', async (state) => {
      return {
        outcomes: {
          [state.taskId]: await r().task(
            state.taskId,
            (state.outcomes[state.taskId]?.attempts ?? 0) + 1,
            state.outcomes[state.taskId]?.error ?? null
          )
        }
      }
    })
    .addNode('validateUnit', (state) => {
      const pending = state.pending.filter(
        (id) => !state.batch.includes(id) || state.outcomes[id]?.error
      )
      const failure = state.batch
        .map((id) => state.outcomes[id])
        .find((outcome) => outcome?.error && outcome.attempts > r().retries)
      r().progress(
        'generate',
        r().generationTasks().length - pending.length,
        r().generationTasks().length
      )
      if (failure) throw new Error(`局部流程未完成：${failure.taskId}；${failure.error}`)
      return { pending }
    })
    .addNode('validateResult', () => {
      const result = r().compose()
      r().validate(result)
      return { result }
    })
    .addEdge(START, 'prepareAnalysis')
    .addEdge('prepareAnalysis', 'detectLanguage')
    .addEdge('detectLanguage', 'buildBasicIndex')
    .addConditionalEdges(
      'buildBasicIndex',
      (state) => (state.pending.length ? 'planIndexBatch' : 'mergeIndexes'),
      ['planIndexBatch', 'mergeIndexes']
    )
    .addConditionalEdges('planIndexBatch', (state) =>
      state.batch.map((taskId) => new Send('indexFile', { ...state, taskId }))
    )
    .addEdge('indexFile', 'mergeIndexes')
    .addConditionalEdges(
      'mergeIndexes',
      (state) => (state.pending.length ? 'planIndexBatch' : 'resolveReferences'),
      ['planIndexBatch', 'resolveReferences']
    )
    .addEdge('resolveReferences', 'assessCoverage')
    .addConditionalEdges(
      'assessCoverage',
      (state) => (state.pending.length ? 'planIndexBatch' : 'buildGenerationTasks'),
      ['planIndexBatch', 'buildGenerationTasks']
    )
    .addConditionalEdges(
      'buildGenerationTasks',
      (state) => (state.pending.length ? 'planGenerationBatch' : 'validateResult'),
      ['planGenerationBatch', 'validateResult']
    )
    .addConditionalEdges('planGenerationBatch', (state) =>
      state.batch.map((taskId) => new Send('generateUnit', { ...state, taskId }))
    )
    .addEdge('generateUnit', 'validateUnit')
    .addConditionalEdges(
      'validateUnit',
      (state) => (state.pending.length ? 'planGenerationBatch' : 'validateResult'),
      ['planGenerationBatch', 'validateResult']
    )
    .addEdge('validateResult', END)
    .compile({ checkpointer: saver })
}
