import type { CodeFlowGraphInput, CodeFlowGraphRunOptions } from '../ai/graph/code-flow.types'
import { createFileCodeFlowCheckpointer } from '../ai/graph/checkpointers/file-code-flow.checkpointer'
import { createCodeFlowAgent } from '../agents/code-flow.agent'

const codeFlowAgent = createCodeFlowAgent()
const defaultGraphRunOptions: Omit<CodeFlowGraphRunOptions, 'callbacks'> = {
  checkpointer: createFileCodeFlowCheckpointer(
    process.env.CODE2FLOW_CHECKPOINT_FILE ?? '.code2flow/checkpoints/code-flow-checkpoints.json'
  )
}

export async function generateFlow(
  input: CodeFlowGraphInput,
  options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
) {
  return codeFlowAgent.generate(input, {
    ...defaultGraphRunOptions,
    ...options
  })
}

export async function streamGenerateFlow(
  input: CodeFlowGraphInput,
  callbacks: NonNullable<CodeFlowGraphRunOptions['callbacks']>,
  options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
) {
  return codeFlowAgent.stream(input, callbacks, {
    ...defaultGraphRunOptions,
    ...options
  })
}

export async function followUpFlow(
  input: CodeFlowGraphInput,
  options?: Omit<CodeFlowGraphRunOptions, 'callbacks'>
) {
  return codeFlowAgent.followUp(input, {
    ...defaultGraphRunOptions,
    ...options
  })
}
