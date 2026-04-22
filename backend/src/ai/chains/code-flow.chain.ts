import type { FlowGenerationResult } from '../../domain/flow/types'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createOpenAIModel } from '../llms/openai'
import { parseCodeFlowTextResult } from '../parsers/code-flow.parser'
import { buildCodeFlowSystemPrompt } from '../prompts/code-flow.system.prompt'
import { buildCodeFlowUserPrompt } from '../prompts/code-flow.user.prompt'

export async function generateCodeFlowWithLangChain(code: string): Promise<FlowGenerationResult> {
  const model = createOpenAIModel()
  const systemPrompt = buildCodeFlowSystemPrompt()
  const userPrompt = buildCodeFlowUserPrompt(code)

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt)
  ])
  const rawText =
    typeof response.content === 'string' ? response.content : extractText(response.content)

  return parseCodeFlowTextResult(rawText)
}

function extractText(
  content: typeof import('@langchain/core/messages').AIMessage.prototype.content
) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if ('text' in item && typeof item.text === 'string') {
          return item.text
        }

        return ''
      })
      .join('')
  }

  return ''
}
