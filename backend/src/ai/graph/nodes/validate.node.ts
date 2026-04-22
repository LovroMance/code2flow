import type { CodeFlowGraphState } from '../code-flow.state'
import { validateMermaid } from '../../../utils/mermaidValidator'

export async function validateNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  if (!state.result) {
    return {
      ...state,
      error: 'Missing generation result'
    }
  }

  if (!validateMermaid(state.result.mermaid)) {
    return {
      ...state,
      error: 'Generated Mermaid is invalid'
    }
  }

  return {
    ...state,
    error: undefined
  }
}
