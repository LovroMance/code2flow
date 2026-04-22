import type { CodeFlowGraphState } from '../code-flow.state'

export async function retryNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  return {
    ...state,
    retryCount: state.retryCount + 1
  }
}
