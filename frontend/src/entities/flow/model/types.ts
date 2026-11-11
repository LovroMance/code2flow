export type { SupportedLanguage } from './languages'

export type NodeKind = 'start' | 'action' | 'decision' | 'return' | 'end'

export interface NodeMapping {
  nodeId: string
  kind: NodeKind
  label: string
  lineStart: number
  lineEnd: number
  description: string
}

export interface HealthResponse {
  ok: boolean
  service: string
}
