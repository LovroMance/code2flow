import type { CodeFlowGraphState } from '../code-flow.state'

// 校验节点之后只负责做轻量分流，不承载具体业务逻辑。
export function routeAfterValidation(state: CodeFlowGraphState) {
  if (!state.error && state.result) {
    return 'normalize'
  }

  if (state.retryCount < state.maxRetries) {
    return 'retry'
  }

  return 'error'
}
