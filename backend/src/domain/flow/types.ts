import type { z } from 'zod'
import type {
  GenerationRequestSchema,
  GenerationResultSchema,
  NodeKindSchema,
  NodeMappingSchema
} from './schema'

export type NodeKind = z.infer<typeof NodeKindSchema>
export type NodeMapping = z.infer<typeof NodeMappingSchema>
export type FlowGenerationResult = z.infer<typeof GenerationResultSchema>
export type FlowGenerationRequest = z.infer<typeof GenerationRequestSchema>

export interface FlowStreamEvent {
  type: 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[]
}
