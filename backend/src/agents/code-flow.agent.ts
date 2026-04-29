import type { FlowGenerationResult } from '../domain/flow/types'
import type { CodeFlowGraphInput, CodeFlowGraphRunOptions } from '../ai/graph/code-flow.types'
import { generateCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { streamCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import {
  explainCodeFlowFollowUpWithGraph,
  generateCodeFlowWithGraph,
  streamCodeFlowWithGraph
} from '../ai/graph/code-flow.graph'

export function createCodeFlowAgent() {
  return {
    async generate(
      input: CodeFlowGraphInput,
      options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
    ): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return generateCodeFlowWithLangChain(input.code)
      }

      if (provider === 'graph') {
        return generateCodeFlowWithGraph(input, options)
      }

      if (input.mode === 'followup') {
        throw new Error('Follow-up mode requires CODE2FLOW_AGENT_PROVIDER=graph')
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    },

    async followUp(
      input: CodeFlowGraphInput,
      options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
    ): Promise<string> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'graph') {
        return explainCodeFlowFollowUpWithGraph(input, options)
      }

      throw new Error('Follow-up mode requires CODE2FLOW_AGENT_PROVIDER=graph')
    },

    async stream(
      input: CodeFlowGraphInput,
      callbacks: NonNullable<CodeFlowGraphRunOptions['callbacks']>,
      options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
    ): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return streamCodeFlowWithLangChain(input.code, callbacks)
      }

      if (provider === 'graph') {
        return streamCodeFlowWithGraph(input, callbacks, options)
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    }
  }
}
