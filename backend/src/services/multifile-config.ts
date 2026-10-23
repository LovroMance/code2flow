import { z } from 'zod'

export class MultiConfigurationError extends Error {}

/** 模型请求和预算预留共用同一个单次输出上限。 */
export function modelOutputTokens() {
  const parsed = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(process.env.CODE2FLOW_MODEL_MAX_OUTPUT_TOKENS ?? 4000)
  if (!parsed.success)
    throw new MultiConfigurationError(
      '单次模型输出上限 CODE2FLOW_MODEL_MAX_OUTPUT_TOKENS 必须为正整数。'
    )
  return parsed.data
}

/** 统一解析运行预算；上下文窗口必须按真实供应商配置，不能猜测默认值。 */
export function multiConfig() {
  const positive = z.coerce.number().int().positive()
  const result = z
    .object({
      // 上传文件数量和 UTF-8 总字节上限。
      maxFiles: positive.max(1000),
      maxTotalBytes: positive,
      // 图批次及全局模型请求使用的并发上限。
      concurrency: positive.max(20),
      // 整次分析允许的模型调用数及累计输入、输出预算。
      maxCalls: positive,
      maxInput: positive,
      maxOutput: positive,
      // 整次分析超时时间，单位毫秒。
      timeout: positive,
      // 单次模型调用的真实上下文窗口，包含输入和预留输出。
      contextTokens: positive,
      // graph 控制的额外重试次数，不叠加 SDK 自动重试。
      retries: z.coerce.number().int().min(0).max(10),
      outputTokens: positive,
      chunkLines: positive.min(2).max(200),
      chunkChars: positive.min(256).max(12000)
    })
    .safeParse({
      maxFiles: process.env.CODE2FLOW_MULTI_MAX_FILES ?? 20,
      maxTotalBytes: process.env.CODE2FLOW_MULTI_MAX_TOTAL_BYTES ?? 2097152,
      concurrency: process.env.CODE2FLOW_MULTI_CONCURRENCY ?? 3,
      maxCalls: process.env.CODE2FLOW_MULTI_MAX_MODEL_CALLS ?? 120,
      maxInput: process.env.CODE2FLOW_MULTI_MAX_INPUT_TOKENS ?? 600000,
      maxOutput: process.env.CODE2FLOW_MULTI_MAX_OUTPUT_TOKENS ?? 80000,
      timeout: process.env.CODE2FLOW_MULTI_TIMEOUT_MS ?? 900000,
      contextTokens: process.env.CODE2FLOW_MODEL_CONTEXT_TOKENS,
      retries: process.env.CODE2FLOW_MAX_RETRIES ?? 1,
      outputTokens: modelOutputTokens(),
      chunkLines: process.env.CODE2FLOW_MULTI_CHUNK_LINES ?? 60,
      chunkChars: process.env.CODE2FLOW_MULTI_CHUNK_CHARS ?? 2000
    })
  if (!result.success)
    throw new MultiConfigurationError(
      `多文件配置无效：${result.error.issues.map((issue) => issue.path.join('.')).join('、')}；请按 .env.example 设置供应商上下文窗口和分析预算。`
    )
  return result.data
}
/** 源码读取和工具响应的硬限制，避免单次工具输出占满模型上下文。 */
export const SOURCE_LIMITS = {
  // 单文件 UTF-8 字节上限。
  maxFileBytes: 204800,
  // 单次 read_code 的选择器数量、总行数和 UTF-16 字符数。
  selectors: 8,
  readLines: 200,
  readChars: 12000,
  // 默认搜索条数、每条摘要字符数及目录/索引分页大小。
  searchLimit: 8,
  snippetChars: 400,
  pageSize: 20,
  // 超过此活动块数量只跳过向量通道，仍建立全部源码索引。
  maxVectors: 2000
}

// 所有会话共用信号量；等待者可取消，释放时不会向已取消任务交接。
let active = 0
const waiting = new Set<() => void>()
export async function modelPermit<T>(limit: number, signal: AbortSignal, action: () => Promise<T>) {
  while (active >= limit) {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        waiting.delete(wake)
        signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        waiting.delete(wake)
        reject(signal.reason)
      }
      waiting.add(wake)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  signal.throwIfAborted()
  active++
  try {
    return await action()
  } finally {
    active--
    for (const wake of [...waiting]) wake()
  }
}
