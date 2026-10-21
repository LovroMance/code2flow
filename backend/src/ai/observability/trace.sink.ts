import { resolve } from 'node:path'
import type { TraceSink } from './trace.collector'
import { createJsonlTraceSink } from './trace.builder'

let cachedSink: TraceSink | null = null
let cachedEnabled: boolean | null = null

// 观测默认开启但可一键关闭，评估跑批时通常关掉以免污染线上轨迹文件。
export function isTracingEnabled() {
  if (cachedEnabled === null) {
    cachedEnabled = process.env.CODE2FLOW_TRACE !== 'off'
  }

  return cachedEnabled
}

// sink 单例：避免每个请求都重建路径解析和写队列。
export function getTraceSink(): TraceSink {
  if (!cachedSink) {
    cachedSink = createJsonlTraceSink(
      getTraceFilePath()
    )
  }

  return cachedSink
}

export function getTraceFilePath() {
  return resolve(process.env.CODE2FLOW_TRACE_FILE ?? '.code2flow/traces/runs.jsonl')
}

// 测试里需要重置单例，否则会跨用例复用旧路径。
export function resetTraceSinkForTesting() {
  cachedSink = null
  cachedEnabled = null
}
