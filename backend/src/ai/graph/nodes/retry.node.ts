import type { CodeFlowGraphState } from '../code-flow.state'

// 重试节点只更新重试状态并清理本轮瞬时结果，方便下一轮重新分析。
export async function retryNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  console.log(
    `[code-flow][graph][retry] threadId=${state.threadId ?? 'none'} nextRetry=${state.retryCount + 1} reason=${state.error ?? 'unknown'}`
  )

  return {
    ...state,
    retryCount: state.retryCount + 1,
    error: undefined,
    result: undefined
  }
}
