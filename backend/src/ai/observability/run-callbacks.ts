import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { AIMessageChunk, isAIMessage, isBaseMessage } from '@langchain/core/messages'
import { normalizeMermaidSource } from '../../utils/mermaidNormalizer'
import { validateMermaid } from '../../utils/mermaidValidator'
import type { TraceCollector } from './trace.collector'
import { chineseErrorMessage } from '../../utils/errorMessage'

// 标准回调同时覆盖生成与追问；chunk 拼接和部分 JSON 解析交给 LangChain。
export function createRunCallbacks(trace?: TraceCollector, onPartial?: (source: string) => void) {
  let message: AIMessageChunk | undefined
  let lastSource = ''
  return [
    BaseCallbackHandler.fromMethods({
      handleChatModelStart() {
        message = undefined
        trace?.countLlmRound()
      },
      handleLLMNewToken(_token, _indices, _runId, _parent, _tags, fields) {
        const chunk = fields?.chunk
        if (
          !onPartial ||
          !chunk ||
          !('message' in chunk) ||
          !(chunk.message instanceof AIMessageChunk)
        )
          return
        message = message ? message.concat(chunk.message) : chunk.message
        const partial = message.tool_calls?.find((call) => call.name === 'submit_code_flow_result')
          ?.args.mermaid
        if (typeof partial !== 'string') return
        const source = normalizeMermaidSource(partial.split('\n').slice(0, -1).join('\n'))
        if (source !== lastSource && validateMermaid(source)) {
          lastSource = source
          onPartial(source)
        }
      },
      handleLLMEnd(output) {
        const generation = output.generations[0]?.[0]
        if (
          !generation ||
          !('message' in generation) ||
          !isBaseMessage(generation.message) ||
          !isAIMessage(generation.message)
        )
          return
        const usage = generation.message.usage_metadata
        const responseModel =
          generation.message.response_metadata.model_name ??
          generation.message.response_metadata.model
        if (typeof responseModel === 'string') trace?.setResponseModel?.(responseModel)
        if (usage)
          trace?.addUsage({
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: usage.total_tokens
          })
      }
    })
  ]
}

// 只采集三个业务节点，过滤框架内部的细粒度 chain，避免轨迹被实现细节淹没。
export function createNodeCallbacks(trace?: TraceCollector) {
  const active = new Map<string, { name: string; start: number }>()
  const finish = (id: string, error?: string) => {
    const step = active.get(id)
    if (step) {
      trace?.addStep({ name: step.name, durationMs: Date.now() - step.start, ok: !error, error })
      active.delete(id)
    }
  }
  return [
    BaseCallbackHandler.fromMethods({
      handleChainStart(_chain, _input, id, _parent, _tags, _metadata, _runType, name) {
        if (trace && name && ['analyze', 'validate', 'explain'].includes(name))
          active.set(id, { name, start: Date.now() })
      },
      handleChainEnd(output, id) {
        finish(id, typeof output.error === 'string' ? output.error : undefined)
      },
      handleChainError(error, id) {
        finish(id, chineseErrorMessage(error))
      }
    })
  ]
}
