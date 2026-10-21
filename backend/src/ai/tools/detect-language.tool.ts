import { z } from 'zod'
import { LanguageChoiceSchema, LanguageDetectionSchema } from '../../domain/flow/schema'
import type { LanguageDetection } from '../../domain/flow/types'
import { LanguageDetectionConfigError, requestLanguageChoice } from '../clients/jev.client'

export const DetectLanguageResultSchema = LanguageDetectionSchema

const ConfigSchema = z.object({
  model: z.string().trim().min(1),
  timeout: z.coerce.number().int().min(1).max(60000),
  minConfidence: z.coerce.number().min(0).max(1)
})

// Jev 只负责分类；临时失败降级为 unknown，流程图仍可使用通用规则生成。
export async function runDetectLanguage(code: string): Promise<LanguageDetection> {
  const config = ConfigSchema.safeParse({
    model: process.env.TYPESAFE_DEFAULT_MODEL ?? 'jev-1.14.0',
    timeout: process.env.CODE2FLOW_LANGUAGE_TIMEOUT_MS ?? 5000,
    minConfidence: process.env.CODE2FLOW_LANGUAGE_MIN_CONFIDENCE ?? 0.6
  })
  if (!config.success) {
    console.error('[code-flow][jev] config-error', {
      invalidFields: config.error.issues.map((issue) => issue.path.join('.'))
    })
    throw new LanguageDetectionConfigError('Jev 模型、超时或置信度配置无效')
  }

  console.info('[code-flow][jev] detection-start', {
    codeLength: code.length,
    minConfidence: config.data.minConfidence
  })

  try {
    const raw = await requestLanguageChoice(code, config.data.model, config.data.timeout)
    const answer = LanguageChoiceSchema.parse(raw)
    const uncertain = answer.choice === 'unknown' || answer.confidence < config.data.minConfidence
    console.info('[code-flow][jev] detection-result', {
      choice: answer.choice,
      confidence: answer.confidence,
      language: uncertain ? 'unknown' : answer.choice,
      status: uncertain ? 'uncertain' : 'detected',
      reason:
        answer.choice === 'unknown' ? 'unknown_choice' : uncertain ? 'low_confidence' : 'accepted',
      topCandidates: Object.entries(answer.probabilities)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([language, probability]) => ({ language, probability }))
    })
    return {
      language: uncertain ? 'unknown' : answer.choice,
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      status: uncertain ? 'uncertain' : 'detected'
    }
  } catch (error) {
    if (error instanceof LanguageDetectionConfigError) throw error
    const reason = error instanceof z.ZodError ? 'invalid_response' : 'request_failed'
    console.warn('[code-flow][jev] detection-fallback', {
      model: config.data.model,
      language: 'unknown',
      reason,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      invalidFields:
        error instanceof z.ZodError ? error.issues.map((issue) => issue.path.join('.')) : undefined
    })
    return { language: 'unknown', confidence: 0, status: 'unavailable', reason }
  }
}
