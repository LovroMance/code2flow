import type { SupportedLanguage } from '../../domain/flow/types'
import type {
  CodeFlowGraphCheckpoint,
  CodeFlowGraphMode,
  CodeFlowGraphState
} from './code-flow.state'

// Graph 输入统一收口在这里，后面扩展 follow-up 或会话恢复时不需要改动多层签名。
export interface CodeFlowGraphInput {
  code: string
  threadId?: string
  question?: string
  mode?: CodeFlowGraphMode
  maxRetries?: number
}

// Graph 对外暴露的流式回调，供 controller/service 按需透传。
export interface CodeFlowGraphCallbacks {
  onPartialMermaid?: (mermaid: string) => void
  onDetectedLanguage?: (payload: {
    detectedLanguage: SupportedLanguage
    confidence?: number
  }) => void
}

// 先定义 checkpointer 的读写边界，后面接真实存储时直接实现这个接口即可。
export interface CodeFlowGraphCheckpointer {
  load(input: {
    threadId: string
    mode: CodeFlowGraphMode
  }): Promise<CodeFlowGraphCheckpoint | null>
  save(input: {
    threadId: string
    mode: CodeFlowGraphMode
    checkpoint: CodeFlowGraphCheckpoint
  }): Promise<void>
}

// graph 运行时的附加选项统一放这里，避免入口函数参数继续膨胀。
export interface CodeFlowGraphRunOptions {
  callbacks?: CodeFlowGraphCallbacks
  checkpointer?: CodeFlowGraphCheckpointer
}

export type CodeFlowGraphTerminalState = Pick<
  CodeFlowGraphState,
  'threadId' | 'mode' | 'result' | 'explanation' | 'error'
>
