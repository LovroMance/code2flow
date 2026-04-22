export interface NodeMapping {
  nodeId: string
  lineStart: number
  lineEnd: number
  description: string
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
