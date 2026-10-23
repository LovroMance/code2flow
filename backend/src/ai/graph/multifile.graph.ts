import { END, START, Send, StateGraph, StateSchema, ReducedValue } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { z } from 'zod'
import { LanguageDetectionSchema } from '../../domain/flow/schema'
import { MultiFileFlowResultSchema, CoverageSchema } from '../../domain/multifile/schema'

/** 单个任务本轮结果；error 为 null 表示成功，fatal 表示重试也无法解决。 */
export const TaskOutcomeSchema = z.object({
  // 与 pending 中的调度身份一致。
  taskId: z.string(),
  // 累计执行次数，包括第一次调用。
  attempts: z.number().int(),
  // 下一轮传给同角色的安全校验反馈。
  error: z.string().nullable(),
  fatal: z.boolean()
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
  // 分别绑定不可变源码集合和本次生成，重新生成时清空旧结果与问答。
  snapshotId: z.string().default(''),
  analysisId: z.string().default(''),
  // 程序调用 Jev 得到的语言，后续所有角色共用。
  languageDetection: LanguageDetectionSchema.nullable().default(null),
  // 调度大阶段；具体进度通过 runtime.progress 发出。
  stage: z.enum(['index', 'generate', 'complete']).default('index'),
  // 未完成任务、当前并发批次、Send 分支当前任务。
  pending: z.array(z.string()).default([]),
  batch: z.array(z.string()).default([]),
  taskId: z.string().default(''),
  // 并行分支按 taskId 合并，不能用数组追加而重复累计重试结果。
  outcomes: new ReducedValue(z.record(z.string(), TaskOutcomeSchema).default({}), {
    reducer: mergeTaskOutcomes
  }),
  // 生成前检查覆盖，完成后保存整图；失败时不保留可用旧图。
  coverage: CoverageSchema.nullable().default(null),
  result: MultiFileFlowResultSchema.nullable().default(null),
  // 仅保存用户问题和对外解释，不保存模型内部推理。
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .default([]),
  // 供会话恢复判断上次分析是否失败。
  error: z.string().nullable().default(null),
  // 调用数、用量、缓存等统计快照，不是源码上下文。
  budget: z.record(z.string(), z.unknown()).default({})
})
export type MultiState = typeof MultiFileState.State
export interface MultiFileRuntime {
  prepare(): Promise<void>
  detect(): Promise<z.infer<typeof LanguageDetectionSchema>>
  basic(): Promise<void>
  indexTasks(): string[]
  generationTasks(): string[]
  verificationTasks(): string[]
  concurrency: number
  retries: number
  task(id: string, attempt: number, feedback: string | null): Promise<TaskOutcome>
  merge(): void
  repairIndexes(error?: unknown): string[]
  resolve(): Promise<void>
  finishReferences(): void
  coverage(): z.infer<typeof CoverageSchema>
  compose(): z.infer<typeof MultiFileFlowResultSchema>
  validate(result: z.infer<typeof MultiFileFlowResultSchema>): void
  progress(stage: string, completed: number, total: number): void
  budget(): Record<string, unknown>
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
      console.log('[code-flow][v2] node-start', { node: 'prepareAnalysis' })
      await r().prepare()
      return { result: null, messages: [], error: null }
    })
    .addNode('detectLanguage', async () => {
      console.log('[code-flow][v2] node-start', { node: 'detectLanguage' })
      return { languageDetection: await r().detect() }
    })
    .addNode('buildBasicIndex', async () => {
      console.log('[code-flow][v2] node-start', { node: 'buildBasicIndex' })
      await r().basic()
      return { pending: r().indexTasks(), stage: 'index' as const }
    })
    .addNode('planIndexBatch', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'planIndexBatch' })
      return { batch: state.pending.slice(0, r().concurrency) }
    })
    .addNode('indexFile', async (state) => {
      console.log('[code-flow][v2] node-start', { node: 'indexFile', taskId: state.taskId })
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
      console.log('[code-flow][v2] node-start', { node: 'mergeIndexes' })
      const pending = state.pending.filter(
        (id) => !state.batch.includes(id) || state.outcomes[id]?.error
      )
      const failure = state.batch
        .map((id) => state.outcomes[id])
        .find((outcome) => outcome?.error && (outcome.fatal || outcome.attempts > r().retries))
      r().progress('index', r().indexTasks().length - pending.length, r().indexTasks().length)
      if (failure) throw new Error(`文件索引未完成：${failure.taskId}；${failure.error}`)
      if (!pending.length) {
        try {
          r().merge()
        } catch (error) {
          const repair = r().repairIndexes(error)
          if (
            !repair.length ||
            repair.some((id) => (state.outcomes[id]?.attempts ?? 0) > r().retries)
          )
            throw error
          return {
            pending: repair,
            outcomes: Object.fromEntries(
              repair.map((id) => [
                id,
                {
                  ...state.outcomes[id]!,
                  error: '合并发现执行单元边界冲突，请定点补读相关源码并修正边界标记。'
                }
              ])
            ),
            budget: r().budget()
          }
        }
      }
      return { pending, budget: r().budget() }
    })
    .addNode('resolveReferences', async () => {
      console.log('[code-flow][v2] node-start', { node: 'resolveReferences' })
      await r().resolve()
      return { pending: r().verificationTasks() }
    })
    .addNode('verifyBatch', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'verifyBatch' })
      return { batch: state.pending.slice(0, r().concurrency) }
    })
    .addNode('verifyReference', async (state) => {
      console.log('[code-flow][v2] node-start', { node: 'verifyReference', taskId: state.taskId })
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
    .addNode('validateReferences', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'validateReferences' })
      const pending = state.pending.filter(
        (id) => !state.batch.includes(id) || state.outcomes[id]?.error
      )
      const failure = state.batch
        .map((id) => state.outcomes[id])
        .find((outcome) => outcome?.error && (outcome.fatal || outcome.attempts > r().retries))
      if (failure) throw new Error(`关系核对未完成：${failure.taskId}；${failure.error}`)
      r().progress(
        'verify',
        r().verificationTasks().length - pending.length,
        r().verificationTasks().length
      )
      return { pending, budget: r().budget() }
    })
    .addNode('assessCoverage', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'assessCoverage' })
      const coverage = r().coverage()
      if (!coverage.complete) {
        const repair = r().repairIndexes()
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
                  error: '执行单元跨块边界仍未确认，请补读前后邻近源码并修正片段身份或起止边界。'
                }
              ])
            ),
            coverage
          }
        throw new Error(
          `源码覆盖未完成：${JSON.stringify({ files: coverage.files.filter((f) => f.missing.length), unresolvedRanges: coverage.unresolvedRanges })}`
        )
      }
      r().finishReferences()
      return { coverage, pending: [] }
    })
    .addNode('buildGenerationTasks', () => {
      console.log('[code-flow][v2] node-start', { node: 'buildGenerationTasks' })
      const pending = r().generationTasks()
      r().progress('generate', 0, pending.length)
      return { pending, stage: 'generate' as const }
    })
    .addNode('planGenerationBatch', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'planGenerationBatch' })
      return { batch: state.pending.slice(0, r().concurrency) }
    })
    .addNode('generateUnit', async (state) => {
      console.log('[code-flow][v2] node-start', { node: 'generateUnit', taskId: state.taskId })
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
      console.log('[code-flow][v2] node-start', { node: 'validateUnit' })
      const pending = state.pending.filter(
        (id) => !state.batch.includes(id) || state.outcomes[id]?.error
      )
      const failure = state.batch
        .map((id) => state.outcomes[id])
        .find((outcome) => outcome?.error && (outcome.fatal || outcome.attempts > r().retries))
      r().progress(
        'generate',
        r().generationTasks().length - pending.length,
        r().generationTasks().length
      )
      if (failure) throw new Error(`局部流程未完成：${failure.taskId}；${failure.error}`)
      return { pending, budget: r().budget() }
    })
    .addNode('composeResult', () => {
      console.log('[code-flow][v2] node-start', { node: 'composeResult' })
      return { result: r().compose() }
    })
    .addNode('validateResult', (state) => {
      console.log('[code-flow][v2] node-start', { node: 'validateResult' })
      if (!state.result) throw new Error('缺少最终结果。')
      r().validate(state.result)
      r().progress('complete', state.result.mappings.length, state.result.mappings.length)
      return { stage: 'complete' as const, budget: r().budget() }
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
    .addConditionalEdges(
      'resolveReferences',
      (state) => (state.pending.length ? 'verifyBatch' : 'assessCoverage'),
      ['verifyBatch', 'assessCoverage']
    )
    .addConditionalEdges('verifyBatch', (state) =>
      state.batch.map((taskId) => new Send('verifyReference', { ...state, taskId }))
    )
    .addEdge('verifyReference', 'validateReferences')
    .addConditionalEdges(
      'validateReferences',
      (state) => (state.pending.length ? 'verifyBatch' : 'assessCoverage'),
      ['verifyBatch', 'assessCoverage']
    )
    .addConditionalEdges(
      'assessCoverage',
      (state) => (state.pending.length ? 'planIndexBatch' : 'buildGenerationTasks'),
      ['planIndexBatch', 'buildGenerationTasks']
    )
    .addConditionalEdges(
      'buildGenerationTasks',
      (state) => (state.pending.length ? 'planGenerationBatch' : 'composeResult'),
      ['planGenerationBatch', 'composeResult']
    )
    .addConditionalEdges('planGenerationBatch', (state) =>
      state.batch.map((taskId) => new Send('generateUnit', { ...state, taskId }))
    )
    .addEdge('generateUnit', 'validateUnit')
    .addConditionalEdges(
      'validateUnit',
      (state) => (state.pending.length ? 'planGenerationBatch' : 'composeResult'),
      ['planGenerationBatch', 'composeResult']
    )
    .addEdge('composeResult', 'validateResult')
    .addEdge('validateResult', END)
    .compile({ checkpointer: saver })
}
