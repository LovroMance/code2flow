import type { CodeFlowGraphState } from '../code-flow.state'

// 入口模式先决定走生成链路还是追问解释链路。
export function routeByMode(state: CodeFlowGraphState) {
  return state.mode === 'followup' ? 'followup' : 'generate'
}

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
