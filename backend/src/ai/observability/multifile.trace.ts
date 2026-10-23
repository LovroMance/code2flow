import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getTraceFilePath, isTracingEnabled } from './trace.sink'

// 与旧trace共用开关和文件；operation版本独立，旧生成用量读取器不会误合并索引或Embedding。
export async function recordMultiFileTrace(input: {
  analysisId: string
  snapshotId: string
  sessionId: string
  operation: 'multifile' | 'multifile-followup'
  outcome: 'success' | 'error'
  source?: 'online' | 'eval'
  metrics: Record<string, unknown>
}) {
  if (!isTracingEnabled()) return
  try {
    const file = getTraceFilePath()
    await mkdir(dirname(file), { recursive: true })
    await appendFile(
      file,
      JSON.stringify({ version: 2, finishedAt: new Date().toISOString(), ...input }) + '\n',
      'utf8'
    )
  } catch {
    console.warn('[code-flow][v2] trace-write-failed', {
      message: '分析统计记录写入失败',
      analysisId: input.analysisId
    })
  }
}
