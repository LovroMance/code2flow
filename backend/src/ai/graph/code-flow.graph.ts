import type { FlowGenerationResult } from '../../domain/flow/types'
import type { CodeFlowGraphInput, CodeFlowGraphRunOptions } from './code-flow.types'
import {
  applyCodeFlowGraphCheckpoint,
  createCodeFlowGraphCheckpoint,
  createInitialCodeFlowGraphState
} from './code-flow.state'
import { analyzeFlowNode } from './nodes/analyze-flow.node'
import { detectLanguageNode } from './nodes/detect-language.node'
import { explainFollowUpNode } from './nodes/explain-followup.node'
import { normalizeFlowNode } from './nodes/normalize-flow.node'
import { retryNode } from './nodes/retry.node'
import { routeAfterValidation, routeByMode } from './routers/code-flow.router'
import { validateNode } from './nodes/validate.node'

// 非流式入口：按 detect -> analyze -> validate -> normalize/retry 的顺序驱动 graph。
export async function generateCodeFlowWithGraph(
  input: CodeFlowGraphInput,
  options?: CodeFlowGraphRunOptions
): Promise<FlowGenerationResult> {
  const state = await runCodeFlowGraph(input, options)

  if (!state.result) {
    throw new Error('Graph finished without a result')
  }

  return state.result
}

// 追问入口直接返回 explanation，供 follow-up API 使用。
export async function explainCodeFlowFollowUpWithGraph(
  input: CodeFlowGraphInput,
  options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
) {
  const state = await runCodeFlowGraph(
    {
      ...input,
      mode: 'followup'
    },
    options
  )

  if (!state.explanation) {
    throw new Error('Graph follow-up finished without an explanation')
  }

  return state.explanation
}

// 流式入口与非流式共享同一条 graph 主链，只是在分析阶段额外透出 partial Mermaid。
export async function streamCodeFlowWithGraph(
  input: CodeFlowGraphInput,
  callbacks: NonNullable<CodeFlowGraphRunOptions['callbacks']>,
  options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
): Promise<FlowGenerationResult> {
  const state = await runCodeFlowGraph(input, {
    ...options,
    callbacks
  })

  if (!state.result) {
    throw new Error('Graph finished without a result')
  }

  return state.result
}

// 统一的 graph 执行入口让非流式和流式共用同一套初始化、checkpoint 和状态迁移逻辑。
async function runCodeFlowGraph(input: CodeFlowGraphInput, options?: CodeFlowGraphRunOptions) {
  let state = await initializeCodeFlowGraphState(input, options)
  const mode = routeByMode(state)

  if (mode === 'followup') {
    state = await explainFollowUpNode(state)
    await persistCodeFlowGraphState(state, options)

    if (state.error) {
      throw new Error(state.error)
    }

    return state
  }

  state = await detectLanguageNode(state, {
    onDetectedLanguage: options?.callbacks?.onDetectedLanguage
  })
  await persistCodeFlowGraphState(state, options)

  while (true) {
    state = await analyzeFlowNode(state, {
      onPartialMermaid: options?.callbacks?.onPartialMermaid
    })
    state = await validateNode(state)

    // 流式模式和非流式模式都走同一套路由，避免线程状态被两套逻辑维护。
    const route = routeAfterValidation(state)

    if (route === 'normalize') {
      state = await normalizeFlowNode(state)
      await persistCodeFlowGraphState(state, options)

      return state
    }

    if (route === 'error') {
      await persistCodeFlowGraphState(state, options)
      throw new Error(state.error ?? 'Graph generation failed')
    }

    state = await retryNode(state)
    await persistCodeFlowGraphState(state, options)
  }
}

// 初始化时优先使用本次请求参数，再叠加同线程的历史快照，为后续 checkpoint 接入留标准位置。
async function initializeCodeFlowGraphState(
  input: CodeFlowGraphInput,
  options?: CodeFlowGraphRunOptions
) {
  const initialState = createInitialCodeFlowGraphState(input)

  if (!options?.checkpointer || !initialState.threadId) {
    return initialState
  }

  const checkpoint = await options.checkpointer.load({
    threadId: initialState.threadId,
    mode: initialState.mode
  })

  return applyCodeFlowGraphCheckpoint(initialState, checkpoint)
}

// 当前阶段先把持久化边界固定住，后面接内存、文件或数据库实现都走这里。
async function persistCodeFlowGraphState(
  state: ReturnType<typeof createInitialCodeFlowGraphState>,
  options?: CodeFlowGraphRunOptions
) {
  if (!options?.checkpointer || !state.threadId) {
    return
  }

  await options.checkpointer.save({
    threadId: state.threadId,
    mode: state.mode,
    checkpoint: createCodeFlowGraphCheckpoint(state)
  })
}
