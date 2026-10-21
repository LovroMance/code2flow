import { open } from 'node:fs/promises'
import { z } from 'zod'
import type { UsageRecord } from '../../domain/usage/schema'

const Count = z.number().int().nonnegative()
// 只读取列表需要的字段；历史额外字段由 Zod 丢弃，不回传源码和原始错误。
const StoredTraceSchema = z.object({
  runId: z.string(),
  startedAt: z.iso.datetime(),
  source: z.enum(['online', 'eval']).optional(),
  responseModels: z.array(z.string()).optional(),
  input: z.object({ mode: z.enum(['generate', 'followup']) }),
  config: z.object({ model: z.string() }),
  outcome: z.enum(['success', 'error']),
  usage: z.object({
    llmRounds: Count,
    reportedRounds: Count.optional(),
    promptTokens: Count,
    completionTokens: Count,
    totalTokens: Count,
    retryCount: Count
  })
})

// 限制每次扫描末尾 4 MiB，避免控制台随着日志增长无界加载。
const MAX_SCAN_BYTES = 4 * 1024 * 1024

export async function readUsageRecords(filePath: string) {
  let file
  try {
    file = await open(filePath, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: [], scanLimited: false }
    }
    throw error
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('用量记录路径不是文件')
    const { size } = stat
    const start = Math.max(0, size - MAX_SCAN_BYTES)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    // 截断窗口首行和正在写入的末行不能当作完整 JSONL 记录。
    if (start > 0) lines.shift()
    lines.pop()
    const records: UsageRecord[] = []
    for (const line of lines) {
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        continue
      }
      const parsed = StoredTraceSchema.safeParse(raw)
      if (!parsed.success) continue
      const trace = parsed.data
      if (trace.input.mode !== 'generate' || trace.source === 'eval') continue
      const usage = trace.usage
      const reported = usage.reportedRounds
      const completeness =
        reported === undefined
          ? 'unknown'
          : reported === 0
            ? 'missing'
            : reported === usage.llmRounds
              ? 'complete'
              : 'partial'
      // 旧日志的全零值无法区分缺失与真实零，保守展示为未知。
      const hasUsage = reported === undefined ? usage.totalTokens > 0 : reported > 0
      records.push({
        runId: trace.runId,
        startedAt: trace.startedAt,
        requestedModel: trace.config.model,
        responseModels: trace.responseModels ?? [],
        outcome: trace.outcome,
        promptTokens: hasUsage ? usage.promptTokens : null,
        completionTokens: hasUsage ? usage.completionTokens : null,
        totalTokens: hasUsage ? usage.totalTokens : null,
        retryCount: usage.retryCount,
        completeness,
        source: trace.source === 'online' ? 'online' : 'unknown'
      })
    }
    records.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    return { records: records.slice(0, 50), scanLimited: start > 0 }
  } finally {
    await file.close()
  }
}
