import { isAxiosError } from 'axios'

/** 界面统一使用中文错误说明，不直接展示浏览器或依赖库的英文异常。 */
export function chineseErrorMessage(error: unknown, fallback = '操作失败，请稍后重试。'): string {
  if (isAxiosError<{ error?: unknown }>(error)) {
    const serverMessage = error.response?.data?.error
    if (typeof serverMessage === 'string' && /[\u4e00-\u9fff]/u.test(serverMessage))
      return serverMessage
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return '请求超时，请稍后重试。'
    if (error.code === 'ERR_CANCELED') return '请求已取消。'
    if (!error.response) return '网络连接失败，请确认后端服务已启动。'
    const status = error.response.status
    if (status === 401 || status === 403) return '访问被拒绝，请检查登录状态或服务权限。'
    if (status === 404) return '请求的接口或资源不存在，请刷新后重试。'
    if (status === 413) return '上传内容过大，请减少文件数量或大小。'
    if (status === 429) return '请求过于频繁，请稍后重试。'
    return fallback
  }
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  if (error instanceof SyntaxError) return '服务返回的数据格式异常，无法解析。'
  if (/abort|cancel/i.test(message) || (error instanceof Error && error.name === 'AbortError'))
    return '操作已取消。'
  if (/timeout|timed out/i.test(message)) return '请求超时，请稍后重试。'
  if (/fetch|network|load failed/i.test(message)) return '网络连接失败，请确认后端服务已启动。'
  return /[\u4e00-\u9fff]/u.test(message) ? message : fallback
}
