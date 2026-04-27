import { createCodeFlowAgent } from '../agents/code-flow.agent'

const codeFlowAgent = createCodeFlowAgent()

export async function generateFlow(code: string) {
  return codeFlowAgent.generate(code)
}

export async function streamGenerateFlow(
  code: string,
  callbacks: {
    onPartialMermaid: (mermaid: string) => void
    onDetectedLanguage?: (payload: {
      detectedLanguage: import('../domain/flow/types').SupportedLanguage
      confidence?: number
    }) => void
  }
) {
  return codeFlowAgent.stream(code, callbacks)
}
