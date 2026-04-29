import type { CodeFlowGraphMode } from '../code-flow.state'

// follow-up 读取的是生成链路沉淀下来的上下文，所以两种模式共用生成态命名空间。
export function buildCheckpointKey(threadId: string, mode: CodeFlowGraphMode) {
  const namespace = mode === 'followup' ? 'generate' : mode
  return `${namespace}:${threadId}`
}
