import type { FlowGenerationResult } from '../../domain/flow/types'
import type { CodeFlowGraphState } from './code-flow.state'
import { analyzeNode } from './nodes/analyze.node'
import { retryNode } from './nodes/retry.node'
import { validateNode } from './nodes/validate.node'

const MAX_RETRIES = 1

export async function generateCodeFlowWithGraph(code: string): Promise<FlowGenerationResult> {
  let state: CodeFlowGraphState = {
    code,
    retryCount: 0
  }

  while (true) {
    state = await analyzeNode(state)
    state = await validateNode(state)

    if (!state.error && state.result) {
      return state.result
    }

    if (state.retryCount >= MAX_RETRIES) {
      throw new Error(state.error ?? 'Graph generation failed')
    }

    state = await retryNode(state)
  }
}
