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
export async function runDetectLanguage(
  code: string,
  signal?: AbortSignal,
  onUsage?: (info: { model: string; usage: Record<string, number> }) => void
): Promise<LanguageDetection> {
  const config = ConfigSchema.safeParse({
    model: process.env.TYPESAFE_DEFAULT_MODEL ?? 'jev-1.14.0',
    timeout: process.env.CODE2FLOW_LANGUAGE_TIMEOUT_MS ?? 5000,
    minConfidence: process.env.CODE2FLOW_LANGUAGE_MIN_CONFIDENCE ?? 0.6
  })
  if (!config.success) {
    console.error('[code-flow][jev] config-error', {
      message: '语言识别配置无效，请检查下列字段',
      invalidFields: config.error.issues.map((issue) => issue.path.join('.'))
    })
    throw new LanguageDetectionConfigError('Jev 模型、超时或置信度配置无效')
  }

  console.info('[code-flow][jev] detection-start', {
    codeLength: code.length,
    minConfidence: config.data.minConfidence
  })

  try {
    const raw = await requestLanguageChoice(
      code,
      config.data.model,
      config.data.timeout,
      signal,
      onUsage
    )
    const answer = LanguageChoiceSchema.parse(raw)
    console.info('[code-flow][jev] detection-result', {
      language: answer.choice,
      confidence: answer.confidence
    })
    const uncertain = answer.choice === 'unknown' || answer.confidence < config.data.minConfidence
    return {
      language: uncertain ? 'unknown' : answer.choice,
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      status: uncertain ? 'uncertain' : 'detected'
    }
  } catch (error) {
    signal?.throwIfAborted()
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
