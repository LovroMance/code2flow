import type { z } from 'zod'
import type {
  FollowUpRequestSchema,
  FollowUpResponseSchema,
  GenerationRequestSchema,
  GenerationResultSchema,
  NodeKindSchema,
  NodeMappingSchema,
  LanguageDetectionSchema
} from './schema'
import type { SupportedLanguageSchema } from './language'

export type NodeKind = z.infer<typeof NodeKindSchema>
export type NodeMapping = z.infer<typeof NodeMappingSchema>
export type FlowGenerationResult = z.infer<typeof GenerationResultSchema>
export type FlowGenerationRequest = z.infer<typeof GenerationRequestSchema>
export type FlowFollowUpRequest = z.infer<typeof FollowUpRequestSchema>
export type FlowFollowUpResponse = z.infer<typeof FollowUpResponseSchema>
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>
export type LanguageDetection = z.infer<typeof LanguageDetectionSchema>

export interface FlowMetadataEvent {
  detectedLanguage: SupportedLanguage
  confidence?: number
}

export interface FlowStreamEvent {
  type: 'metadata' | 'mermaid' | 'mappings' | 'done' | 'error'
  content?: string | NodeMapping[] | FlowMetadataEvent
}
