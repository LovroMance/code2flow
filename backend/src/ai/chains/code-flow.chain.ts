import type { FlowGenerationResult } from '../../domain/flow/types'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createOpenAIModel } from '../llms/openai'
import { extractPartialMermaid, parseCodeFlowTextResult } from '../parsers/code-flow.parser'
import { buildCodeFlowSystemPrompt } from '../prompts/code-flow.system.prompt'
import { buildCodeFlowUserPrompt } from '../prompts/code-flow.user.prompt'
import { validateMermaid } from '../../utils/mermaidValidator'
import { normalizeFlowResultAgainstCode } from '../../utils/mappingNormalizer'

export async function generateCodeFlowWithLangChain(code: string): Promise<FlowGenerationResult> {
  // 先准备模型实例和本次调用需要的提示词。
  const model = createOpenAIModel()
  const systemPrompt = buildCodeFlowSystemPrompt()
  const userPrompt = buildCodeFlowUserPrompt(code)

  // 调用模型，拿到原始响应内容。
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt)
  ])

  // 把 LangChain 的返回统一整理成纯文本，方便后续解析。
  const rawText =
    typeof response.content === 'string' ? response.content : extractText(response.content)

  // 打印原始输出，便于排查模型返回问题。
  // console.log('[code-flow][langchain][raw-output]')
  // console.log(rawText)

  // 把模型文本解析成项目内部统一的结构化结果。
  return normalizeFlowResultAgainstCode(code, parseCodeFlowTextResult(rawText))
}

export async function streamCodeFlowWithLangChain(
  code: string,
  onPartialMermaid: (mermaid: string) => void
): Promise<FlowGenerationResult> {
  // 先准备模型实例和本次调用需要的提示词。
  const model = createOpenAIModel()
  const systemPrompt = buildCodeFlowSystemPrompt()
  const userPrompt = buildCodeFlowUserPrompt(code)

  // 以流式方式消费模型输出，并持续抽取当前已经稳定的 Mermaid 内容。
  const stream = await model.stream([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)])

  let rawText = ''
  let lastMermaid = ''
  let chunkCount = 0

  for await (const chunk of stream) {
    chunkCount += 1
    const chunkText = typeof chunk.content === 'string' ? chunk.content : extractText(chunk.content)

    if (!chunkText) {
      console.log(`[code-flow][langchain][stream] chunk=${chunkCount} empty`)
      continue
    }

    rawText += chunkText
    console.log(
      `[code-flow][langchain][stream] chunk=${chunkCount} textLength=${chunkText.length} rawLength=${rawText.length}`
    )

    const partialMermaid = extractPartialMermaid(rawText)

    if (partialMermaid && partialMermaid !== lastMermaid && validateMermaid(partialMermaid)) {
      lastMermaid = partialMermaid
      console.log(
        `[code-flow][langchain][stream] emit-partial lines=${partialMermaid.split('\n').length} length=${partialMermaid.length}`
      )
      onPartialMermaid(partialMermaid)
    }
  }

  // 流结束后，对完整输出做最终解析和校验。
  console.log(
    `[code-flow][langchain][stream] completed chunks=${chunkCount} rawLength=${rawText.length}`
  )
  console.log('[code-flow][langchain][raw-output]')
  console.log(rawText)

  return normalizeFlowResultAgainstCode(code, parseCodeFlowTextResult(rawText))
}

function extractText(
  content: typeof import('@langchain/core/messages').AIMessage.prototype.content
) {
  if (Array.isArray(content)) {
    // 把分段响应提取并拼成一段完整文本。
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

  // 没有可提取文本时返回空串兜底。
  return ''
}
