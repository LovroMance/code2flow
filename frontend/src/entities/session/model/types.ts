import { LANGUAGE_OPTIONS } from '../../flow/model/languages'
import type { SupportedLanguage } from '../../flow/model/types'

export interface SessionSummary {
  id: string
  title: string
  fileName: string
  createdAt: string
  updatedAt: string
  language: SupportedLanguage
  hasResult: boolean
  hasDraft: boolean
  busy: boolean
}
export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}
export interface SessionWrite {
  title?: string
  fileName?: string
  draftLanguage?: SupportedLanguage
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function language(value: unknown): value is SupportedLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value)
}
function summary(value: unknown): value is SessionSummary {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    language(value.language) &&
    typeof value.hasResult === 'boolean' &&
    typeof value.hasDraft === 'boolean' &&
    typeof value.busy === 'boolean'
  )
}
export function parseSessionList(value: unknown): SessionSummary[] {
  if (!object(value) || !Array.isArray(value.sessions) || !value.sessions.every(summary)) {
    throw new Error('会话列表格式异常，请刷新重试。')
  }
  return value.sessions
}
export function parseSessionSummary(value: unknown): SessionSummary {
  if (!summary(value)) throw new Error('会话信息格式异常，请重试。')
  return value
}
