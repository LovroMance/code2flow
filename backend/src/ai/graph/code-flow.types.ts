import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { SupportedLanguage } from '../../domain/flow/types'
import type { TraceCollector } from '../observability/trace.collector'

export interface CodeFlowGraphInput {
  code: string
  threadId?: string
  question?: string
  mode?: 'generate' | 'followup'
  maxRetries?: number
}

export interface CodeFlowGraphCallbacks {
  onPartialMermaid?: (mermaid: string) => void
  onDetectedLanguage?: (payload: {
    detectedLanguage: SupportedLanguage
    confidence?: number
  }) => void
}

// 使用框架原生依赖；模型与 checkpointer 可注入，便于无密钥集成验证。
export interface CodeFlowGraphRunOptions {
  callbacks?: CodeFlowGraphCallbacks
  checkpointer?: BaseCheckpointSaver
  model?: BaseChatModel
  trace?: TraceCollector
}
