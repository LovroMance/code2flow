import { createCodeFlowAgent } from '../agents/code-flow.agent'

const codeFlowAgent = createCodeFlowAgent()

export async function generateFlow(input: { code: string; threadId?: string }) {
  return codeFlowAgent.generate(input)
}

export async function streamGenerateFlow(
  input: { code: string; threadId?: string },
  callbacks: {
    onPartialMermaid: (mermaid: string) => void
    onDetectedLanguage?: (payload: {
      detectedLanguage: import('../domain/flow/types').SupportedLanguage
      confidence?: number
    }) => void
  }
) {
  return codeFlowAgent.stream(input, callbacks)
}
