import type { SupportedLanguage } from '../../domain/flow/types'

export function buildLanguageSpecificSystemPrompt(language: SupportedLanguage) {
  if (language === 'unknown') return '代码语言未确定，请按通用程序控制流分析。'
  return `代码语言：${language}。请按该语言的语义分析控制流。`
}
