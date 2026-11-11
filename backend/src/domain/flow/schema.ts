import { z } from 'zod'
import { SupportedLanguageSchema } from './language'

const ProbabilitySchema = z.number().min(0).max(1)

// Choice 的概率必须完整覆盖候选集，防止把畸形响应当作可靠检测。
export const LanguageChoiceSchema = z
  .object({
    type: z.literal('choice'),
    choice: SupportedLanguageSchema,
    confidence: ProbabilitySchema,
    probabilities: z.record(SupportedLanguageSchema, ProbabilitySchema)
  })
  .refine(
    (answer) => {
      const values = Object.values(answer.probabilities)
      const sum = values.reduce((total, value) => total + value, 0)
      return (
        Math.abs(sum - 1) < 0.01 &&
        answer.probabilities[answer.choice] >= Math.max(...values) - 0.000001
      )
    },
    { message: '分支概率分布无效。' }
  )

export const LanguageDetectionSchema = z.object({
  language: SupportedLanguageSchema,
  choice: SupportedLanguageSchema.optional(),
  confidence: ProbabilitySchema,
  probabilities: z.record(SupportedLanguageSchema, ProbabilitySchema).optional(),
  status: z.enum(['detected', 'uncertain', 'unavailable']),
  reason: z.string().optional()
})

export const NodeKindSchema = z.enum(['start', 'action', 'decision', 'return', 'end'])
