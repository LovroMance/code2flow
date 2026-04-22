import { createCodeFlowAgent } from '../agents/code-flow.agent'

const codeFlowAgent = createCodeFlowAgent()

export async function generateFlow(code: string) {
  return codeFlowAgent.generate(code)
}
