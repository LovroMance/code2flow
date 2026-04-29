import type { FlowGenerationResult } from '../domain/flow/types'
import { generateCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { streamCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { generateCodeFlowWithGraph, streamCodeFlowWithGraph } from '../ai/graph/code-flow.graph'

export function createCodeFlowAgent() {
  return {
    async generate(input: { code: string; threadId?: string }): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return generateCodeFlowWithLangChain(input.code)
      }

      if (provider === 'graph') {
        return generateCodeFlowWithGraph(input)
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    },

    async stream(
      input: { code: string; threadId?: string },
      callbacks: {
        onPartialMermaid: (mermaid: string) => void
        onDetectedLanguage?: (payload: {
          detectedLanguage: import('../domain/flow/types').SupportedLanguage
          confidence?: number
        }) => void
      }
    ): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return streamCodeFlowWithLangChain(input.code, callbacks)
      }

      if (provider === 'graph') {
        return streamCodeFlowWithGraph(input, callbacks)
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    }
  }
}
