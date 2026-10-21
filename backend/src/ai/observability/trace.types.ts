import type { SupportedLanguage } from '../../domain/flow/types'

// 单次 graph 运行的结构化轨迹，是后续评估和 A/B 对比的唯一数据来源。
export interface RunTrace {
  source?: 'online' | 'eval'
  responseModels?: string[]
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  config: RunTraceConfig
  input: RunTraceInput
  steps: TraceStep[]
  outcome: 'success' | 'error'
  result?: RunTraceResultSummary
  error?: string
  usage: RunTraceUsage
}

// 记录这次运行用的是哪套配置，A/B 对比时靠它区分实验组。
export interface RunTraceConfig {
  provider: string
  promptVariant: string
  model: string
  temperature: number
  maxRetries: number
  // 配置指纹：由上面五项哈希得出，聚合时直接当分组键用。
  configHash: string
}

// 只记录代码指纹和长度，避免把完整源码重复写进轨迹文件。
export interface RunTraceInput {
  codeLength: number
  codeLines: number
  codeHash: string
  threadId?: string
  mode: 'generate' | 'followup'
}

// 每个节点的执行切片，用于定位耗时瓶颈和失败环节。
export interface TraceStep {
  name: string
  startedAt: string
  durationMs: number
  ok: boolean
  error?: string
}

// 最终结果的摘要指标，不存完整 mermaid，避免轨迹文件膨胀。
export interface RunTraceResultSummary {
  detectedLanguage: SupportedLanguage
  mermaidLines: number
  mappingCount: number
  nodeKinds: Record<string, number>
  coveredLineCount: number
}

// 模型调用侧的用量统计，用于观察成本和轮次。
export interface RunTraceUsage {
  reportedRounds?: number
  llmRounds: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  retryCount: number
  validationErrors: string[]
}
