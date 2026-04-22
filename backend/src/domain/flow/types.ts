import type { z } from 'zod'
import type { GenerationRequestSchema, GenerationResultSchema, NodeMappingSchema } from './schema'

export type NodeMapping = z.infer<typeof NodeMappingSchema>
export type FlowGenerationResult = z.infer<typeof GenerationResultSchema>
export type FlowGenerationRequest = z.infer<typeof GenerationRequestSchema>

export interface FlowStreamEvent {
  type: 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[]
}
