import { z } from 'zod'
import { SupportedLanguageSchema } from '../flow/language'
import { GenerationResultSchema } from '../flow/schema'

export const SessionIdSchema = z.string().trim().min(1).max(200)
export const SessionWriteSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  fileName: z.string().max(255).optional(),
  draftCode: z
    .string()
    .max(200 * 1024)
    .optional(),
  draftLanguage: SupportedLanguageSchema.optional()
})
export const SessionCreateSchema = SessionWriteSchema.extend({ id: SessionIdSchema.optional() })

// 草稿与分析快照分别存储，编辑草稿不能覆盖 LangGraph 用于追问的源码。
export const SessionMetadataSchema = z.object({
  id: SessionIdSchema,
  title: z.string(),
  fileName: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  draftCode: z.string().nullable(),
  draftLanguage: SupportedLanguageSchema
})
export const SessionSummarySchema = SessionMetadataSchema.omit({
  draftCode: true,
  draftLanguage: true
}).extend({
  language: SupportedLanguageSchema,
  hasResult: z.boolean(),
  hasDraft: z.boolean(),
  busy: z.boolean()
})
export const SessionDetailSchema = SessionSummarySchema.extend({
  draftCode: z.string(),
  draftLanguage: SupportedLanguageSchema,
  sourceCode: z.string(),
  result: GenerationResultSchema.nullable(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  failed: z.boolean()
})
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>
export type SessionWrite = z.infer<typeof SessionWriteSchema>
