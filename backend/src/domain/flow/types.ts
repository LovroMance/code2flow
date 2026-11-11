import type { z } from 'zod'
import type { LanguageDetectionSchema } from './schema'
import type { SupportedLanguageSchema } from './language'

export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>
export type LanguageDetection = z.infer<typeof LanguageDetectionSchema>
