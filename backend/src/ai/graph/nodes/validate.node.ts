import type { CodeFlowGraphState } from '../code-flow.state'
import { parseFlowGenerationResult } from '../../../utils/flowResultValidator'
import { validateMermaid } from '../../../utils/mermaidValidator'

// 校验节点同时兜住结构、Mermaid 和语言一致性，便于后续统一重试。
export async function validateNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  if (!state.result) {
    return {
      ...state,
      error: 'Missing generation result',
      validationErrors: ['Missing generation result']
    }
  }

  try {
    // 这里会连带校验 schema、重复 nodeId 和 mapping 是否都能在 Mermaid 中找到。
    parseFlowGenerationResult(state.result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generation result'

    return {
      ...state,
      error: message,
      validationErrors: [message]
    }
  }

  if (!validateMermaid(state.result.mermaid)) {
    return {
      ...state,
      error: 'Generated Mermaid is invalid',
      validationErrors: ['Generated Mermaid is invalid']
    }
  }

  // graph 提前检测过语言，这里再做一次对齐校验，避免结果里语言漂移。
  if (state.detectedLanguage && state.result.detectedLanguage !== state.detectedLanguage) {
    return {
      ...state,
      error: `Detected language mismatch: expected ${state.detectedLanguage} but got ${state.result.detectedLanguage}`,
      validationErrors: [
        `Detected language mismatch: expected ${state.detectedLanguage} but got ${state.result.detectedLanguage}`
      ]
    }
  }

  return {
    ...state,
    error: undefined,
    validationErrors: undefined
  }
}
