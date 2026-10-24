import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { AIMessageChunk } from '@langchain/core/messages'
import { normalizeMermaidSource } from '../../utils/mermaidNormalizer'
import { validateMermaid } from '../../utils/mermaidValidator'

/** 将模型工具参数转换为完整 Mermaid 快照，供 SSE 渐进展示；不承担用量采集。 */
export function createMermaidStreamCallbacks(onPartial?: (source: string) => void) {
  if (!onPartial) return []
  let message: AIMessageChunk | undefined
  let lastSource = ''
  return [
    BaseCallbackHandler.fromMethods({
      handleChatModelStart() {
        message = undefined
      },
      handleLLMNewToken(_token, _indices, _runId, _parent, _tags, fields) {
        const chunk = fields?.chunk
        if (!chunk || !('message' in chunk) || !(chunk.message instanceof AIMessageChunk)) return
        message = message ? message.concat(chunk.message) : chunk.message
        const partial = message.tool_calls?.find((call) => call.name === 'submit_code_flow_result')
          ?.args.mermaid
        if (typeof partial !== 'string') return
        // 最后一行可能尚未接收完整，沿用现有策略只展示完整行。
        const source = normalizeMermaidSource(partial.split('\n').slice(0, -1).join('\n'))
        if (source !== lastSource && validateMermaid(source)) {
          lastSource = source
          onPartial(source)
        }
      }
    })
  ]
}
