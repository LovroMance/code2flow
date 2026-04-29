import type { CodeFlowGraphState } from '../code-flow.state'
import { generateCodeFlowDraft } from '../../chains/code-flow.chain'

// 分析节点复用 LangChain 底层 draft 生成能力，graph 只负责状态编排。
export async function analyzeFlowNode(
  state: CodeFlowGraphState,
  callbacks?: {
    onPartialMermaid?: (mermaid: string) => void
  }
): Promise<CodeFlowGraphState> {
  console.log(
    `[code-flow][graph][analyze] threadId=${state.threadId ?? 'none'} retry=${state.retryCount} language=${state.detectedLanguage ?? 'unknown'}`
  )

  // 将 graph 中已经拿到的语言结果作为 hint 传入，减少模型在分析阶段的歧义。
  const result = await generateCodeFlowDraft({
    code: state.code,
    detectedLanguageHint: state.detectedLanguage,
    onPartialMermaid: callbacks?.onPartialMermaid
  })

  return {
    ...state,
    result,
    error: undefined,
    validationErrors: undefined
  }
}
