import type { CodeFlowGraphState } from '../code-flow.state'
import { normalizeFlowResultAgainstCode } from '../../../utils/mappingNormalizer'

// 归一化节点负责把模型产出的行号修正到真实可执行代码行上。
export async function normalizeFlowNode(state: CodeFlowGraphState): Promise<CodeFlowGraphState> {
  if (!state.result) {
    return {
      ...state,
      error: 'Missing generation result before normalization',
      validationErrors: ['Missing generation result before normalization']
    }
  }

  return {
    ...state,
    result: normalizeFlowResultAgainstCode(state.code, state.result),
    error: undefined,
    validationErrors: undefined
  }
}
