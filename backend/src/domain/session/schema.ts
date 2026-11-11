import { z } from 'zod'
import { SupportedLanguageSchema } from '../flow/language'

export const SessionIdSchema = z.string().trim().min(1).max(200)
export const SessionWriteSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  fileName: z.string().max(255).optional(),
  draftLanguage: SupportedLanguageSchema.optional()
})
export const SessionCreateSchema = SessionWriteSchema.extend({ id: SessionIdSchema.optional() })

// 会话目录保存标题与编辑器设置，正文和分析快照由工作区保存。
export const SessionMetadataSchema = z.object({
  id: SessionIdSchema,
  title: z.string(),
  fileName: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  draftLanguage: SupportedLanguageSchema
})
export const SessionSummarySchema = SessionMetadataSchema.omit({
  draftLanguage: true
}).extend({
  language: SupportedLanguageSchema,
  hasResult: z.boolean(),
  hasDraft: z.boolean(),
  busy: z.boolean()
})
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>
export type SessionWrite = z.infer<typeof SessionWriteSchema>
