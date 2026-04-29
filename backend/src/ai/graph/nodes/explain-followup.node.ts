import type { CodeFlowGraphState } from '../code-flow.state'
import { explainCodeFlowFollowUp } from '../../chains/explain-followup.chain'

// follow-up 节点复用上一轮的 result 和 code，只生成解释文本，不重新建图。
export async function explainFollowUpNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  if (!state.question?.trim()) {
    return {
      ...state,
      error: 'Missing follow-up question'
    }
  }

  if (!state.result) {
    return {
      ...state,
      error: 'Missing previous flow result for follow-up explanation'
    }
  }

  console.log(
    `[code-flow][graph][followup] threadId=${state.threadId ?? 'none'} language=${state.detectedLanguage ?? state.result.detectedLanguage}`
  )

  const explanation = await explainCodeFlowFollowUp({
    code: state.code,
    question: state.question,
    result: state.result
  })

  return {
    ...state,
    explanation,
    error: undefined
  }
}
