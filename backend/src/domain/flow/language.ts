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
  'kotlin',
  'swift',
  'objectivec',
  'dart',
  'ruby',
  'scala',
  'lua',
  'r',
  'perl',
  'shell',
  'powershell',
  'sql',
  'unknown'
])

export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>
