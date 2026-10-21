import { createAgent, modelCallLimitMiddleware, toolStrategy } from 'langchain'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { FlowDraftSchema, GenerationResultSchema } from '../../domain/flow/schema'
import type { SupportedLanguage } from '../../domain/flow/types'
import { CODE_FLOW_PROMPT_RULES } from '../../prompts/code-flow.prompt'
import { buildLanguageSpecificSystemPrompt } from '../prompts/code-flow-language.system.prompt'
import { createOpenAIModel } from '../llms/openai'
import { createRunCallbacks } from '../observability/run-callbacks'
import type { CodeFlowGraphRunOptions } from '../graph/code-flow.types'

// 框架接管工具绑定、消息往返和结构化结果提取；业务层只提供契约和修正反馈。
export async function generateCodeFlowDraft(
  input: { code: string; detectedLanguage: SupportedLanguage; feedback?: string | null },
  options: CodeFlowGraphRunOptions = {}
) {
  const systemPrompt = [
    CODE_FLOW_PROMPT_RULES,
    buildLanguageSpecificSystemPrompt(input.detectedLanguage)
  ].join('\n\n')
  const messages = [
    new HumanMessage(input.code),
    ...(input.feedback
      ? [new SystemMessage(`上次生成未通过校验，请修正以下问题后重新提交：\n${input.feedback}`)]
      : [])
  ]

  // 展示系统规则和本次输入，便于核对首次生成与重试时的消息内容。
  console.log('[code-flow][chain] input messages')
  console.dir(
    [
      { role: 'system', content: systemPrompt },
      ...messages.map((message) => ({
        role: message instanceof HumanMessage ? 'user' : 'system',
        content: message.content
      }))
    ],
    { depth: null }
  )

  const agent = createAgent({
    model: options.model ?? createOpenAIModel(),
    tools: [],
    // 系统提示词由两部分组成：通用规则 + 语言特定规则
    systemPrompt,
    // 按照 JSON Schema 校验结构化结果，避免模型输出不符合预期的内容。
    responseFormat: toolStrategy(
      FlowDraftSchema.meta({ title: 'submit_code_flow_result' }),
      { handleError: false }
    ),
    middleware: [modelCallLimitMiddleware({ runLimit: 1, exitBehavior: 'error' })]
  })
  const output = await agent.invoke(
    { messages },
    { callbacks: createRunCallbacks(options.trace, options.callbacks?.onPartialMermaid) }
  )

  console.log('[code-flow][chain] agent output')
  // console.dir(output, { depth: null })

  // 语言只取 Jev 结果，模型无需输出，也无法覆盖它；Zod 校验行号等跨字段约束。
  const draft = FlowDraftSchema.parse(output.structuredResponse)
  const result = GenerationResultSchema.parse({ ...draft, detectedLanguage: input.detectedLanguage })
  console.log('[code-flow][chain] validated result')
  console.dir(result, { depth: null })
  return result
}
