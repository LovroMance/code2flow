import type { CodeFlowGraphState } from '../code-flow.state'
import { generateCodeFlowWithLangChain } from '../../chains/code-flow.chain'

export async function analyzeNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  const result = await generateCodeFlowWithLangChain(state.code)

  return {
    ...state,
    result,
    error: undefined
  }
}
