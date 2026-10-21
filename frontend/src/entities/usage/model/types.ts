export interface UsageRecord {
  runId: string
  startedAt: string
  requestedModel: string
  responseModels: string[]
  outcome: 'success' | 'error'
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  retryCount: number
  completeness: 'complete' | 'partial' | 'missing' | 'unknown'
  source: 'online' | 'unknown'
}

export interface UsageList {
  tracingEnabled: boolean
  scanLimited: boolean
  records: UsageRecord[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isUsageRecord(value: unknown): value is UsageRecord {
  if (!isObject(value)) return false
  return (
    typeof value.runId === 'string' &&
    typeof value.startedAt === 'string' &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    typeof value.requestedModel === 'string' &&
    Array.isArray(value.responseModels) &&
    value.responseModels.every((model) => typeof model === 'string') &&
    (value.outcome === 'success' || value.outcome === 'error') &&
    [value.promptTokens, value.completionTokens, value.totalTokens].every(
      (count) => count === null || isCount(count)
    ) &&
    isCount(value.retryCount) &&
    ['complete', 'partial', 'missing', 'unknown'].includes(String(value.completeness)) &&
    (value.source === 'online' || value.source === 'unknown')
  )
}

// 网络边界先校验，再交给页面使用；异常响应进入统一错误状态。
export function parseUsageList(value: unknown): UsageList {
  if (
    !isObject(value) ||
    typeof value.tracingEnabled !== 'boolean' ||
    typeof value.scanLimited !== 'boolean' ||
    !Array.isArray(value.records) ||
    !value.records.every(isUsageRecord)
  ) {
    throw new Error('用量数据格式异常，请刷新重试')
  }
  return {
    tracingEnabled: value.tracingEnabled,
    scanLimited: value.scanLimited,
    records: value.records
  }
}
