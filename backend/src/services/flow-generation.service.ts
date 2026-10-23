import type {
  CodeFlowGraphCallbacks,
  CodeFlowGraphInput,
  CodeFlowGraphRunOptions
} from '../ai/graph/code-flow.types'
import { runCodeFlowGraph } from '../ai/graph/code-flow.graph'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import { createTraceCollector, summarizeResult } from '../ai/observability/trace.builder'
import { getTraceSink, isTracingEnabled } from '../ai/observability/trace.sink'
import { withSessionLock } from './session-lock'
import { getSessionService } from './session.service'
import { chineseErrorMessage } from '../utils/errorMessage'

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

// 一条执行入口覆盖流式、非流式和追问；外部采集器由调用者负责落盘。
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
  const trace =
    options.trace ??
    (isTracingEnabled()
      ? createTraceCollector({ ...input, mode: input.mode ?? 'generate', source: 'online' })
      : undefined)
  try {
    const state = await runCodeFlowGraph(input, {
      ...options,
      trace,
      checkpointer: options.checkpointer ?? (input.threadId ? getCodeFlowCheckpointer() : undefined)
    })
    if (input.mode !== 'followup' && state.result) trace?.setResult(summarizeResult(state.result))
    return state
  } catch (error) {
    trace?.setError(chineseErrorMessage(error))
    throw error
  } finally {
    if (trace && !options.trace) {
      try {
        await getTraceSink().write(await trace.finish())
      } catch (error) {
        console.warn('[code2flow][trace] 统计记录写入失败：', chineseErrorMessage(error))
      }
    }
  }
}
