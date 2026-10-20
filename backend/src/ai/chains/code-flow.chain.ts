import { createAgent, modelCallLimitMiddleware, toolStrategy } from 'langchain'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { GenerationResultSchema } from '../../domain/flow/schema'
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
  const agent = createAgent({
    model: options.model ?? createOpenAIModel(),
    tools: [],
    systemPrompt: [
      CODE_FLOW_PROMPT_RULES,
      buildLanguageSpecificSystemPrompt(input.detectedLanguage)
    ].join('\n\n'),
    responseFormat: toolStrategy(
      GenerationResultSchema.meta({ title: 'submit_code_flow_result' }),
      { handleError: false }
    ),
    middleware: [modelCallLimitMiddleware({ runLimit: 1, exitBehavior: 'error' })]
  })
  const output = await agent.invoke(
    {
      messages: [
        new HumanMessage(input.code),
        ...(input.feedback
          ? [new SystemMessage(`上次生成未通过校验，请修正以下问题后重新提交：\n${input.feedback}`)]
          : [])
      ]
    },
    { callbacks: createRunCallbacks(options.trace, options.callbacks?.onPartialMermaid) }
  )

  // toolStrategy 做 JSON Schema 校验，Zod 再兜住行号等跨字段约束。
  return GenerationResultSchema.parse(output.structuredResponse)
}
