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
    message: '结束行号必须大于或等于起始行号。',
    path: ['lineEnd']
  })
  .refine(
    // 跨行范围的终点列可以小于起点列，仅同一行需要比较列号。
    (mapping) =>
      mapping.lineEnd !== mapping.lineStart ||
      mapping.columnStart === undefined ||
      mapping.columnEnd === undefined ||
      mapping.columnEnd >= mapping.columnStart,
    {
      message: '同一行内的结束列必须大于或等于起始列。',
      path: ['columnEnd']
    }
  )

// 生成模型只提交流程图和映射，语言由程序使用 Jev 检测结果补齐。
export const FlowDraftSchema = z.object({
  mermaid: z.string(),
  mappings: z.array(NodeMappingSchema)
})

export const GenerationResultSchema = FlowDraftSchema.extend({
  detectedLanguage: SupportedLanguageSchema
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
