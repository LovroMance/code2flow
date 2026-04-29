import { z } from 'zod'
import { SupportedLanguageSchema } from './language'

export const NodeKindSchema = z.enum(['start', 'action', 'decision', 'return', 'end'])

export const NodeMappingSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: NodeKindSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    columnStart: z.number().int().positive().optional(),
    columnEnd: z.number().int().positive().optional()
  })
  .refine((mapping) => mapping.lineEnd >= mapping.lineStart, {
    message: 'lineEnd must be greater than or equal to lineStart',
    path: ['lineEnd']
  })
  .refine(
    (mapping) =>
      mapping.columnStart === undefined ||
      mapping.columnEnd === undefined ||
      mapping.columnEnd >= mapping.columnStart,
    {
      message: 'columnEnd must be greater than or equal to columnStart',
      path: ['columnEnd']
    }
  )

export const GenerationResultSchema = z.object({
  detectedLanguage: SupportedLanguageSchema,
  mermaid: z.string(),
  mappings: z.array(NodeMappingSchema)
})

export const GenerationRequestSchema = z.object({
  code: z.string().min(1),
  thread_id: z.string().optional()
})

export const FollowUpRequestSchema = z.object({
  thread_id: z.string().min(1),
  question: z.string().min(1),
  code: z.string().min(1).optional()
})

export const FollowUpResponseSchema = z.object({
  thread_id: z.string(),
  question: z.string(),
  explanation: z.string().min(1)
})
