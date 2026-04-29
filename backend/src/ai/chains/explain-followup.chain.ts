import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { FlowGenerationResult } from '../../domain/flow/types'
import { createOpenAIModel } from '../llms/openai'

// follow-up 分析只需要基于既有结果做解释，不再走 tool calling 或结构化结果生成。
export async function explainCodeFlowFollowUp(input: {
  code: string
  question: string
  result: FlowGenerationResult
}): Promise<string> {
  const response = await createOpenAIModel().invoke([
    new SystemMessage(buildExplainFollowUpSystemPrompt()),
    new HumanMessage(buildExplainFollowUpUserPrompt(input))
  ])

  const explanation = normalizeModelTextResponse(response.content)

  if (!explanation) {
    throw new Error('Model returned an empty explanation')
  }

  return explanation
}

function buildExplainFollowUpSystemPrompt() {
  return `
你是 Code2Flow 的解释型助手。

你的任务不是重新生成流程图，而是基于已有的代码、Mermaid 和节点映射，回答用户对当前分析结果的追问。

要求：
- 回答必须使用中文
- 只解释与当前问题相关的控制流、分支、异步链路、Vue 响应式或生命周期逻辑
- 优先引用节点标签、节点类型、行号范围来解释
- 如果现有结果不足以支持确定结论，要明确说明是基于已有图和映射做出的推断
- 不要输出 Markdown 代码块
- 不要暴露链路推理过程
  `.trim()
}

function buildExplainFollowUpUserPrompt(input: {
  code: string
  question: string
  result: FlowGenerationResult
}) {
  return `
当前代码：
${input.code}

当前检测语言：
${input.result.detectedLanguage}

当前 Mermaid：
${input.result.mermaid}

当前节点映射：
${JSON.stringify(input.result.mappings, null, 2)}

用户追问：
${input.question}

请基于上面的已有分析结果回答，不要重新生成 Mermaid。
  `.trim()
}

function normalizeModelTextResponse(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === 'string'
          ? item
          : typeof item === 'object' && item && 'text' in item && typeof item.text === 'string'
            ? item.text
            : ''
      )
      .join('')
      .trim()
  }

  return ''
}
