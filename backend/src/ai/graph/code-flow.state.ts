import type { FlowGenerationResult, SupportedLanguage } from '../../domain/flow/types'

export type CodeFlowGraphMode = 'generate' | 'followup'

// 这个快照结构是未来 checkpointer 持久化时真正需要保存的最小上下文。
export interface CodeFlowGraphCheckpoint {
  code?: string
  detectedLanguage?: SupportedLanguage
  result?: FlowGenerationResult
  explanation?: string
}

// Graph state 统一承载生成流程和后续追问所需的上下文。
export interface CodeFlowGraphState {
  mode: CodeFlowGraphMode
  threadId?: string
  code: string
  question?: string
  detectedLanguage?: SupportedLanguage
  result?: FlowGenerationResult
  explanation?: string
  error?: string
  validationErrors?: string[]
  retryCount: number
  maxRetries: number
}

// 创建 graph 的初始状态，避免入口处重复拼装默认值。
export function createInitialCodeFlowGraphState(input: {
  code: string
  threadId?: string
  question?: string
  mode?: CodeFlowGraphMode
  maxRetries?: number
}): CodeFlowGraphState {
  return {
    mode: input.mode ?? 'generate',
    threadId: input.threadId,
    code: input.code,
    question: input.question,
    retryCount: 0,
    maxRetries: input.maxRetries ?? 1
  }
}

// 从完整 state 中提取可持久化快照，供未来的 checkpointer 实现复用。
export function createCodeFlowGraphCheckpoint(state: CodeFlowGraphState): CodeFlowGraphCheckpoint {
  return {
    code: state.code,
    detectedLanguage: state.detectedLanguage,
    result: state.result,
    explanation: state.explanation
  }
}

// 将 checkpoint 中可复用的上下文恢复到当前请求的 state 中，但不覆盖本次输入参数。
export function applyCodeFlowGraphCheckpoint(
  state: CodeFlowGraphState,
  checkpoint: CodeFlowGraphCheckpoint | null | undefined
): CodeFlowGraphState {
  if (!checkpoint) {
    return state
  }

  return {
    ...state,
    code: state.code.trim() ? state.code : (checkpoint.code ?? state.code),
    detectedLanguage: checkpoint.detectedLanguage ?? state.detectedLanguage,
    result: checkpoint.result ?? state.result,
    explanation: checkpoint.explanation ?? state.explanation
  }
}
