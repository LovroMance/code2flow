import { z } from 'zod'

export const SupportedLanguageSchema = z.enum([
  'javascript',
  'typescript',
  'vue',
  'java',
  'c',
  'cpp',
  'python',
  'go',
  'rust',
  'csharp',
  'php',
  'unknown'
])

export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>
