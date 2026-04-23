import { createCodeFlowAgent } from '../agents/code-flow.agent'

const codeFlowAgent = createCodeFlowAgent()

export async function generateFlow(code: string) {
  return codeFlowAgent.generate(code)
}

export async function streamGenerateFlow(
  code: string,
  onPartialMermaid: (mermaid: string) => void
) {
  return codeFlowAgent.stream(code, onPartialMermaid)
}
