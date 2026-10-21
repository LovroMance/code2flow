import { LANGUAGE_OPTIONS } from '../../flow/model/languages'
import type { FlowGenerationResult, NodeMapping, SupportedLanguage } from '../../flow/model/types'

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
export interface SessionDetail extends SessionSummary {
  draftCode: string
  draftLanguage: SupportedLanguage
  sourceCode: string
  result: FlowGenerationResult | null
  messages: SessionMessage[]
  failed: boolean
}
export interface SessionWrite {
  title?: string
  fileName?: string
  draftCode?: string
  draftLanguage?: SupportedLanguage
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function language(value: unknown): value is SupportedLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value)
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function mapping(value: unknown): value is NodeMapping {
  if (!object(value)) return false
  return (
    typeof value.nodeId === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    ['start', 'action', 'decision', 'return', 'end'].includes(String(value.kind)) &&
    positive(value.lineStart) &&
    positive(value.lineEnd) &&
    value.lineEnd >= value.lineStart &&
    (value.columnStart === undefined || positive(value.columnStart)) &&
    (value.columnEnd === undefined || positive(value.columnEnd))
  )
}
function result(value: unknown): value is FlowGenerationResult {
  return (
    object(value) &&
    language(value.detectedLanguage) &&
    typeof value.mermaid === 'string' &&
    Array.isArray(value.mappings) &&
    value.mappings.every(mapping)
  )
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
export function parseSessionDetail(value: unknown): SessionDetail {
  if (
    !summary(value) ||
    !object(value) ||
    typeof value.draftCode !== 'string' ||
    !language(value.draftLanguage) ||
    typeof value.sourceCode !== 'string' ||
    (value.result !== null && !result(value.result)) ||
    typeof value.failed !== 'boolean' ||
    !Array.isArray(value.messages) ||
    !value.messages.every(
      (message: unknown) =>
        object(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    )
  ) {
    throw new Error('会话内容格式异常，请重试。')
  }
  // 所有跨边界字段校验通过后，才允许恢复工作区。
  return value as unknown as SessionDetail
}
