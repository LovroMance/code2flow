import type { CodeFlowGraphState } from '../code-flow.state'
import { runDetectLanguage } from '../../tools'

// 语言识别放在 graph 节点里先执行，后面的分析节点就能拿到更稳定的语言提示。
export async function detectLanguageNode(
  state: CodeFlowGraphState,
  callbacks?: {
    onDetectedLanguage?: (payload: {
      detectedLanguage: import('../../../domain/flow/types').SupportedLanguage
      confidence?: number
    }) => void
  }
): Promise<CodeFlowGraphState> {
  const detected = runDetectLanguage(state.code)

  callbacks?.onDetectedLanguage?.({
    detectedLanguage: detected.language,
    confidence: detected.confidence
  })

  console.log(
    `[code-flow][graph][detect-language] threadId=${state.threadId ?? 'none'} language=${detected.language} confidence=${detected.confidence}`
  )

  return {
    ...state,
    detectedLanguage: detected.language
  }
}
