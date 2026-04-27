export type NodeKind = 'start' | 'action' | 'decision' | 'return' | 'end'
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'vue'
  | 'java'
  | 'c'
  | 'cpp'
  | 'python'
  | 'go'
  | 'rust'
  | 'csharp'
  | 'php'
  | 'unknown'

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
  detectedLanguage: SupportedLanguage
  mermaid: string
  mappings: NodeMapping[]
}

export interface HealthResponse {
  ok: boolean
  service: string
}

export interface FlowMetadataEvent {
  detectedLanguage: SupportedLanguage
  confidence?: number
}

export interface FlowStreamEvent {
  type: 'metadata' | 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[] | FlowMetadataEvent
}
