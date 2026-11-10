import { isAxiosError } from 'axios'

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() ? value : ''
  return value == null ? '' : (JSON.stringify(value, null, 2) ?? '')
}

/** 保留接口返回的错误正文，并附上 HTTP 状态。 */
export function formatHttpError(status: number, statusText: string, body: unknown): string {
  if (typeof body === 'string' && body.trimStart().startsWith('{')) {
    try {
      body = JSON.parse(body)
    } catch {
      // 保留无法解析的响应原文。
    }
  }

  let detail = ''
  if (body && typeof body === 'object') {
    const { error, message, details } = body as {
      error?: unknown
      message?: unknown
      details?: unknown
    }
    detail = [...new Set([error, message, details].map(formatValue).filter(Boolean))].join('\n')
  }
  return [`HTTP ${status} ${statusText}`.trimEnd(), detail || formatValue(body)]
    .filter(Boolean)
    .join('\n')
}

/** 只有异常没有可显示的消息时才使用操作提示。 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const { response, code, message } = error
    if (response) return formatHttpError(response.status, response.statusText, response.data)
    return [code, message].filter(Boolean).join(': ') || fallback
  }
  if (typeof error === 'string') return formatValue(error) || fallback
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return formatValue(error.message) || fallback
  return fallback
}
