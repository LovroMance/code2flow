export type NodeKind = 'start' | 'action' | 'decision' | 'return' | 'end'

export interface NodeMapping {
  nodeId: string
  kind: NodeKind
  label: string
  lineStart: number
  lineEnd: number
  description: string
  columnStart?: number
  columnEnd?: number
}

export interface FlowGenerationResult {
  mermaid: string
  mappings: NodeMapping[]
}

export interface HealthResponse {
  ok: boolean
  service: string
}

export interface FlowStreamEvent {
  type: 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[]
}
