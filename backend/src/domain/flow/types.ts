import type { z } from 'zod'
import type {
  GenerationRequestSchema,
  GenerationResultSchema,
  NodeKindSchema,
  NodeMappingSchema
} from './schema'
import type { SupportedLanguageSchema } from './language'

export type NodeKind = z.infer<typeof NodeKindSchema>
export type NodeMapping = z.infer<typeof NodeMappingSchema>
export type FlowGenerationResult = z.infer<typeof GenerationResultSchema>
export type FlowGenerationRequest = z.infer<typeof GenerationRequestSchema>
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>

export interface FlowMetadataEvent {
  detectedLanguage: SupportedLanguage
  confidence?: number
}

export interface FlowStreamEvent {
  type: 'metadata' | 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[] | FlowMetadataEvent
}
