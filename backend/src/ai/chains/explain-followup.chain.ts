import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { CodeFlowGraphState } from '../graph/code-flow.state'
import type { CodeFlowGraphRunOptions } from '../graph/code-flow.types'
import { FOLLOW_UP_PROMPT } from '../../prompts/code-flow.prompt'
import { createOpenAIModel } from '../llms/openai'
import { createRunCallbacks } from '../observability/run-callbacks'

// 图和源码放在系统上下文，历史问答使用原生消息通道，避免手动拼接消息格式。
export async function explainCodeFlowFollowUp(
  state: CodeFlowGraphState,
  options: CodeFlowGraphRunOptions
) {
  const response = await (options.model ?? createOpenAIModel()).invoke(
    [
      new SystemMessage(
        `${FOLLOW_UP_PROMPT}\n当前代码：\n${state.code}\n已有分析结果：\n${JSON.stringify(state.result)}`
      ),
      ...state.messages,
      new HumanMessage(state.question)
    ],
    { callbacks: createRunCallbacks(options.trace) }
  )
  if (!response.text.trim()) throw new Error('模型未返回解释内容，请重新追问。')
  return {
    explanation: response.text.trim(),
    messages: [new HumanMessage(state.question), response]
  }
}
