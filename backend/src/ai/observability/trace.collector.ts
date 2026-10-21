import type { RunTrace, TraceStep } from './trace.types'

// 采集器以"一次请求"为生命周期，业务代码只管往里塞数据，最后由 sink 统一落盘。
export interface TraceCollector {
  addStep(step: Omit<TraceStep, 'startedAt' | 'durationMs'> & { durationMs: number }): void
  countLlmRound(): void
  setResponseModel?(model: string): void
  addUsage(input: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void
  setRetryCount(count: number): void
  setValidationErrors(errors: string[] | undefined): void
  setResult(result: RunTrace['result']): void
  setError(error: string): void
  finish(): Promise<RunTrace>
}

// 统一的轨迹出口。默认落本地文件，后续要接 LangSmith / OTLP 只需换实现。
export interface TraceSink {
  write(trace: RunTrace): Promise<void>
}

// 关闭开关时用空实现，业务代码无需到处写 if。
export const noopTraceCollector: TraceCollector = {
  addStep: () => {},
  countLlmRound: () => {},
  addUsage: () => {},
  setRetryCount: () => {},
  setValidationErrors: () => {},
  setResult: () => {},
  setError: () => {},
  finish: async () =>
    ({
      runId: 'noop',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      config: {
        provider: 'noop',
        promptVariant: 'none',
        model: 'none',
        temperature: 0,
        maxRetries: 0,
        configHash: 'noop'
      },
      input: { codeLength: 0, codeLines: 0, codeHash: '', mode: 'generate' },
      steps: [],
      outcome: 'success',
      usage: {
        llmRounds: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        retryCount: 0,
        validationErrors: []
      }
    }) satisfies RunTrace
}
