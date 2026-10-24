import type {
  CodeFlowGraphCallbacks,
  CodeFlowGraphInput,
  CodeFlowGraphRunOptions
} from '../ai/graph/code-flow.types'
import { runCodeFlowGraph } from '../ai/graph/code-flow.graph'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import { withSessionLock } from './session-lock'
import { getSessionService } from './session.service'
import { analysisTraceConfig, traceStep } from '../ai/observability/langsmith'

export async function generateFlow(input: CodeFlowGraphInput, options?: CodeFlowGraphRunOptions) {
  return (await runFlow({ ...input, mode: 'generate' }, options)).result!
}

export async function streamGenerateFlow(
  input: CodeFlowGraphInput,
  callbacks: CodeFlowGraphCallbacks,
  options?: CodeFlowGraphRunOptions
) {
  return generateFlow(input, { ...options, callbacks })
}

export async function followUpFlow(input: CodeFlowGraphInput, options?: CodeFlowGraphRunOptions) {
  return (await runFlow({ ...input, mode: 'followup' }, options)).explanation
}

// 一条执行入口覆盖流式、非流式和追问，追踪统一交给 LangSmith。
async function runFlow(input: CodeFlowGraphInput, options: CodeFlowGraphRunOptions = {}) {
  const threadId = input.threadId
  if (threadId) {
    return withSessionLock(threadId, async () => {
      const sessions = options.checkpointer ? undefined : getSessionService()
      sessions?.ensure(threadId)
      try {
        return await executeFlow(input, options)
      } finally {
        sessions?.touch(threadId)
      }
    })
  }
  return executeFlow(input, options)
}

async function executeFlow(input: CodeFlowGraphInput, options: CodeFlowGraphRunOptions) {
  const operation = input.mode === 'followup' ? 'followup' : 'generate'
  return traceStep(
    `code2flow.${operation}`,
    input,
    () =>
      runCodeFlowGraph(input, {
        ...options,
        checkpointer:
          options.checkpointer ?? (input.threadId ? getCodeFlowCheckpointer() : undefined)
      }),
    analysisTraceConfig(operation, input.threadId)
  )
}
