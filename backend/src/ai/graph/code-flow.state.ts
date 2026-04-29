import type { FlowGenerationResult, SupportedLanguage } from '../../domain/flow/types'

export type CodeFlowGraphMode = 'generate' | 'followup'

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
