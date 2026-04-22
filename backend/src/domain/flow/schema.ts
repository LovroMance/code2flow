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
