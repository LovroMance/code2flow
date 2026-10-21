import { z } from 'zod'

const TokenCountSchema = z.number().int().nonnegative()

export const UsageRecordSchema = z.object({
  runId: z.string(),
  startedAt: z.iso.datetime(),
  requestedModel: z.string(),
  responseModels: z.array(z.string()),
  outcome: z.enum(['success', 'error']),
  promptTokens: TokenCountSchema.nullable(),
  completionTokens: TokenCountSchema.nullable(),
  totalTokens: TokenCountSchema.nullable(),
  retryCount: TokenCountSchema,
  completeness: z.enum(['complete', 'partial', 'missing', 'unknown']),
  source: z.enum(['online', 'unknown'])
})

export const UsageListSchema = z.object({
  tracingEnabled: z.boolean(),
  scanLimited: z.boolean(),
  records: z.array(UsageRecordSchema)
})

export type UsageRecord = z.infer<typeof UsageRecordSchema>
