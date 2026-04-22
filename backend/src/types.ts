import { z } from 'zod'

export const NodeMappingSchema = z.object({
  nodeId: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  description: z.string()
})

export const GenerationResultSchema = z.object({
  mermaid: z.string(),
  mappings: z.array(NodeMappingSchema)
})

export const GenerationRequestSchema = z.object({
  code: z.string().min(1),
  thread_id: z.string().optional()
})

export type NodeMapping = z.infer<typeof NodeMappingSchema>
export type GenerationResult = z.infer<typeof GenerationResultSchema>
