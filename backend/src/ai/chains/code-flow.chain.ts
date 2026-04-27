import type { FlowGenerationResult } from '../../domain/flow/types'
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessageChunk,
  type BaseMessage
} from '@langchain/core/messages'
import { createOpenAIModel } from '../llms/openai'
import { buildCodeFlowSystemPrompt } from '../prompts/code-flow.system.prompt'
import { buildCodeFlowUserPrompt } from '../prompts/code-flow.user.prompt'
import {
  DETECT_LANGUAGE_TOOL_NAME,
  detectLanguageTool,
  runDetectLanguage,
  SUBMIT_CODE_FLOW_RESULT_TOOL_NAME,
  submitCodeFlowResultTool
} from '../tools'
import { normalizeMermaidSource } from '../../utils/mermaidNormalizer'
import { extractPartialMermaidFromToolArgs } from '../../utils/toolCallResultStreamer'
import { validateMermaid } from '../../utils/mermaidValidator'
import { normalizeFlowResultAgainstCode } from '../../utils/mappingNormalizer'
import { parseFlowGenerationResult } from '../../utils/flowResultValidator'

const MAX_TOOL_ROUNDS = 4

export async function generateCodeFlowWithLangChain(code: string): Promise<FlowGenerationResult> {
  return runCodeFlowToolLoop(code)
}

export async function streamCodeFlowWithLangChain(
  code: string,
  onPartialMermaid: (mermaid: string) => void
): Promise<FlowGenerationResult> {
  return runCodeFlowToolLoop(code, onPartialMermaid)
}

async function runCodeFlowToolLoop(
  code: string,
  onPartialMermaid?: (mermaid: string) => void
): Promise<FlowGenerationResult> {
  const model = createOpenAIModel().bindTools([detectLanguageTool, submitCodeFlowResultTool], {
    parallel_tool_calls: false,
    tool_choice: 'auto'
  })

  const messages: BaseMessage[] = [
    new SystemMessage(buildCodeFlowSystemPrompt()),
    new HumanMessage(buildCodeFlowUserPrompt(code))
  ]
  let hasDetectedLanguage = false
  let lastMermaid = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await streamToolCallingRound(model, messages, onPartialMermaid, {
      getLastMermaid: () => lastMermaid,
      setLastMermaid: (mermaid) => {
        lastMermaid = mermaid
      }
    })
    messages.push(response)

    const toolCalls = response.tool_calls ?? []

    if (toolCalls.length === 0) {
      throw new Error('Model did not call any tools')
    }

    const toolMessages: ToolMessage[] = []

    for (const toolCall of toolCalls) {
      const toolCallId = toolCall.id ?? `${toolCall.name}-${round}`

      if (toolCall.name === DETECT_LANGUAGE_TOOL_NAME) {
        const detected = runDetectLanguage(code)
        hasDetectedLanguage = true
        console.log(
          `[code-flow][langchain][tool] detect_language language=${detected.language} confidence=${detected.confidence}`
        )
        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCallId,
            content: JSON.stringify(detected),
            status: 'success'
          })
        )
        continue
      }

      if (toolCall.name === SUBMIT_CODE_FLOW_RESULT_TOOL_NAME) {
        if (!hasDetectedLanguage) {
          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              content: 'Call detect_language before submitting the final code flow result.',
              status: 'error'
            })
          )
          continue
        }

        const parsed = parseFlowGenerationResult({
          ...toolCall.args,
          mermaid:
            typeof toolCall.args?.mermaid === 'string'
              ? normalizeMermaidSource(toolCall.args.mermaid)
              : toolCall.args?.mermaid
        })

        if (!validateMermaid(parsed.mermaid)) {
          throw new Error('Generated Mermaid is invalid')
        }

        console.log(
          `[code-flow][langchain][tool] submit_code_flow_result language=${parsed.detectedLanguage} mappings=${parsed.mappings.length}`
        )
        return normalizeFlowResultAgainstCode(code, parsed)
      }

      toolMessages.push(
        new ToolMessage({
          tool_call_id: toolCallId,
          content: `Unsupported tool call: ${toolCall.name}`,
          status: 'error'
        })
      )
    }

    messages.push(...toolMessages)
  }

  throw new Error('Model did not submit a valid code flow result within the tool-call limit')
}

async function streamToolCallingRound(
  model: ReturnType<ReturnType<typeof createOpenAIModel>['bindTools']>,
  messages: BaseMessage[],
  onPartialMermaid: ((mermaid: string) => void) | undefined,
  mermaidState: {
    getLastMermaid: () => string
    setLastMermaid: (mermaid: string) => void
  }
) {
  const stream = await model.stream(messages)
  let fullChunk: AIMessageChunk | null = null
  const toolCallStateByIndex = new Map<
    number,
    {
      name: string
      id: string
      args: string
    }
  >()
  let chunkCount = 0

  for await (const chunk of stream) {
    chunkCount += 1
    fullChunk = fullChunk ? fullChunk.concat(chunk) : chunk

    for (const toolCallChunk of chunk.tool_call_chunks ?? []) {
      if (toolCallChunk.index === undefined) {
        continue
      }

      const previousState = toolCallStateByIndex.get(toolCallChunk.index)
      const nextState = {
        name: toolCallChunk.name ?? previousState?.name ?? '',
        id: toolCallChunk.id ?? previousState?.id ?? `tool-call-${toolCallChunk.index}`,
        args: (previousState?.args ?? '') + (toolCallChunk.args ?? '')
      }
      toolCallStateByIndex.set(toolCallChunk.index, nextState)

      if (!onPartialMermaid || nextState.name !== SUBMIT_CODE_FLOW_RESULT_TOOL_NAME) {
        continue
      }

      const partialMermaid = extractPartialMermaidFromToolArgs(nextState.args)

      if (
        partialMermaid &&
        partialMermaid !== mermaidState.getLastMermaid() &&
        validateMermaid(partialMermaid)
      ) {
        mermaidState.setLastMermaid(partialMermaid)
        console.log(
          `[code-flow][langchain][stream] emit-partial chunk=${chunkCount} lines=${partialMermaid.split('\n').length} length=${partialMermaid.length}`
        )
        onPartialMermaid(partialMermaid)
      }
    }
  }

  if (!fullChunk) {
    throw new Error('Model stream ended without producing any chunks')
  }

  if ((fullChunk.tool_calls?.length ?? 0) === 0 && toolCallStateByIndex.size > 0) {
    fullChunk.tool_calls = Array.from(toolCallStateByIndex.entries())
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([, state]) => buildToolCallFromState(state))
      .filter((toolCall): toolCall is ToolCall => toolCall !== null)
  }

  return fullChunk
}

function buildToolCallFromState(state: {
  name: string
  id: string
  args: string
}): ToolCall | null {
  if (!state.name) {
    return null
  }

  try {
    const parsedArgs = JSON.parse(state.args)

    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
      return null
    }

    return {
      name: state.name,
      id: state.id,
      args: parsedArgs,
      type: 'tool_call'
    }
  } catch {
    return null
  }
}

type ToolCall = {
  name: string
  args: Record<string, unknown>
  id?: string
  type?: 'tool_call'
}
