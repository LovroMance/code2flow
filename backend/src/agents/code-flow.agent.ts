import type { FlowGenerationResult } from '../domain/flow/types'
import { generateCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { streamCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { generateCodeFlowWithGraph } from '../ai/graph/code-flow.graph'

export function createCodeFlowAgent() {
  return {
    async generate(code: string): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return generateCodeFlowWithLangChain(code)
      }

      if (provider === 'graph') {
        return generateCodeFlowWithGraph(code)
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    },

    async stream(
      code: string,
      onPartialMermaid: (mermaid: string) => void
    ): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'langchain'

      if (provider === 'langchain') {
        return streamCodeFlowWithLangChain(code, onPartialMermaid)
      }

      if (provider === 'graph') {
        const result = await this.generate(code)
        onPartialMermaid(result.mermaid)
        return result
      }

      throw new Error(`Unsupported CODE2FLOW_AGENT_PROVIDER: ${provider}`)
    }
  }
}
