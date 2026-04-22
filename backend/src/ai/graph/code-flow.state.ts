import type { FlowGenerationResult } from '../../domain/flow/types'

export interface CodeFlowGraphState {
  code: string
  result?: FlowGenerationResult
  error?: string
  retryCount: number
}
