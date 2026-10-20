import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { FlowGenerationResult } from '../../domain/flow/types'
import type { TraceCollector, TraceSink } from './trace.collector'
import type { RunTrace, RunTraceResultSummary, TraceStep } from './trace.types'
import { hashCode, resolveRunConfig, type ResolvedRunConfig } from './run-config'

// JSONL sink：一次运行写一行，便于后续用脚本直接流式统计，不需要整体加载。
export function createJsonlTraceSink(filePath: string): TraceSink {
  const resolvedPath = resolve(filePath)
  let pendingWrite = Promise.resolve()

  return {
    async write(trace: RunTrace) {
      // 串行化写入，避免并发请求把同一行截断。
      pendingWrite = pendingWrite.then(async () => {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await appendFile(resolvedPath, `${JSON.stringify(trace)}\n`, 'utf8')
      })

      await pendingWrite
    }
  }
}

// 采集器把散落在各节点的耗时和用量汇总成一条完整轨迹。
export function createTraceCollector(input: {
  code: string
  mode: 'generate' | 'followup'
  threadId?: string
  maxRetries?: number
  config?: ResolvedRunConfig
}): TraceCollector {
  const config = input.config ?? resolveRunConfig({ maxRetries: input.maxRetries })
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAtMs = Date.now()
  const steps: TraceStep[] = []
  let llmRounds = 0
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let retryCount = 0
  let validationErrors: string[] = []
  let result: RunTrace['result']
  let error: string | undefined

  return {
    addStep(step) {
      steps.push({
        name: step.name,
        ok: step.ok,
        error: step.error,
        startedAt: new Date(Date.now() - step.durationMs).toISOString(),
        durationMs: step.durationMs
      })
    },

    countLlmRound() {
      llmRounds += 1
    },

    addUsage(usage) {
      promptTokens += usage.promptTokens ?? 0
      completionTokens += usage.completionTokens ?? 0
      totalTokens += usage.totalTokens ?? 0
    },

    setRetryCount(count) {
      retryCount = count
    },

    setValidationErrors(errors) {
      validationErrors = errors ?? []
    },

    setResult(nextResult) {
      result = nextResult
    },

    setError(message) {
      error = message
    },

    async finish(): Promise<RunTrace> {
      return {
        runId,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        config,
        input: {
          codeLength: input.code.length,
          codeLines: countLines(input.code),
          codeHash: hashCode(input.code),
          threadId: input.threadId,
          mode: input.mode
        },
        steps,
        outcome: error ? 'error' : 'success',
        result,
        error,
        usage: {
          llmRounds,
          promptTokens,
          completionTokens,
          totalTokens,
          retryCount,
          validationErrors
        }
      }
    }
  }
}

// 结果只保留统计量，完整 mermaid 交给 checkpoint，避免轨迹文件重复膨胀。
export function summarizeResult(result: FlowGenerationResult): RunTraceResultSummary {
  const nodeKinds: Record<string, number> = {}
  const coveredLines = new Set<number>()

  for (const mapping of result.mappings) {
    nodeKinds[mapping.kind] = (nodeKinds[mapping.kind] ?? 0) + 1

    for (let line = mapping.lineStart; line <= mapping.lineEnd; line += 1) {
      coveredLines.add(line)
    }
  }

  return {
    detectedLanguage: result.detectedLanguage,
    mermaidLines: result.mermaid.split('\n').filter((line) => line.trim()).length,
    mappingCount: result.mappings.length,
    nodeKinds,
    coveredLineCount: coveredLines.size
  }
}

function countLines(code: string) {
  const normalized = code.replace(/\r\n/g, '\n')
  return normalized.trim() ? normalized.split('\n').length : 0
}
