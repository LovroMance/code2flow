import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateFlow } from '../services/flow-generation.service'
import { chineseErrorMessage } from '../utils/errorMessage'
import type { TraceSink } from '../ai/observability/trace.collector'
import { createJsonlTraceSink, createTraceCollector } from '../ai/observability/trace.builder'
import { resolveRunConfig, type ResolvedRunConfig } from '../ai/observability/run-config'
import type { EvalDataset } from './dataset.types'
import { evaluateCase, type CaseEvaluation } from './evaluator'

// 一次评估运行的完整产物，落盘后用于 A/B 对比和回归追踪。
export interface EvalRunReport {
  datasetName: string
  config: ResolvedRunConfig
  startedAt: string
  finishedAt: string
  durationMs: number
  cases: CaseEvaluation[]
  summary: EvalSummary
}

export interface EvalSummary {
  total: number
  passed: number
  passRate: number
  averageScore: number
  averageDurationMs: number
  averageLlmRounds: number
  averageTotalTokens: number
  retryRate: number
  failures: string[]
}

// 跑批入口：逐样例调真实 graph，收集结果并汇总。并发度默认 1，避免触发模型限流。
export async function runEvalDataset(input: {
  dataset: EvalDataset
  outputDir: string
  label?: string
  concurrency?: number
}): Promise<{ report: EvalRunReport; reportPath: string }> {
  const config = resolveRunConfig()
  const startedAtMs = Date.now()
  const cases: CaseEvaluation[] = []
  const concurrency = Math.max(1, input.concurrency ?? 1)

  // 评估轨迹单独落一份，和线上 runs.jsonl 隔离，避免跑批把线上观测数据冲淡。
  const evalTracePath = resolve(
    input.outputDir,
    `${input.dataset.name}-${input.label ?? 'run'}.traces.jsonl`
  )
  const traceSink = createJsonlTraceSink(evalTracePath)

  for (let index = 0; index < input.dataset.cases.length; index += concurrency) {
    const batch = input.dataset.cases.slice(index, index + concurrency)
    const batchResults = await Promise.all(
      batch.map((evalCase) => runSingleCase(evalCase, traceSink))
    )
    cases.push(...batchResults)
  }

  const report: EvalRunReport = {
    datasetName: input.dataset.name,
    config,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    cases,
    summary: summarize(cases)
  }

  const label = input.label ?? config.configHash
  const reportPath = resolve(input.outputDir, `${input.dataset.name}-${label}.json`)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

  return { report, reportPath }
}

// 单样例执行：失败不抛出，而是记成一条 fail 结果，保证跑批不会因单点异常中断。
async function runSingleCase(
  evalCase: EvalDataset['cases'][number],
  traceSink: TraceSink
): Promise<CaseEvaluation> {
  const startedAt = Date.now()
  // 评估也必须带采集器，否则报告里的轮次/重试指标全是 0，A/B 就失去意义。
  const trace = createTraceCollector({
    code: evalCase.code,
    mode: 'generate',
    source: 'eval'
  })

  try {
    const result = await generateFlow({ code: evalCase.code }, { trace })
    const evaluation = evaluateCase({ evalCase, result, code: evalCase.code })
    const finished = await trace.finish()
    await traceSink.write(finished)

    return {
      ...evaluation,
      durationMs: Date.now() - startedAt,
      runId: finished.runId,
      llmRounds: finished.usage.llmRounds,
      retryCount: finished.usage.retryCount,
      totalTokens: finished.usage.totalTokens
    }
  } catch (error) {
    const message = chineseErrorMessage(error, '评估执行失败，请检查模型服务和案例。')
    const finished = await trace.finish()
    await traceSink.write(finished)

    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      tags: evalCase.tags,
      checks: [{ name: '执行', passed: false, detail: message }],
      passed: false,
      score: 0,
      durationMs: Date.now() - startedAt,
      runId: finished.runId,
      llmRounds: finished.usage.llmRounds,
      retryCount: finished.usage.retryCount,
      totalTokens: finished.usage.totalTokens
    }
  }
}

function summarize(cases: CaseEvaluation[]): EvalSummary {
  const total = cases.length
  const passed = cases.filter((item) => item.passed).length
  const averageScore = total === 0 ? 0 : cases.reduce((sum, item) => sum + item.score, 0) / total
  const durations = cases.map((item) => item.durationMs ?? 0)
  const rounds = cases.map((item) => item.llmRounds ?? 0)
  const tokens = cases.map((item) => item.totalTokens ?? 0)
  const retried = cases.filter((item) => (item.retryCount ?? 0) > 0).length

  return {
    total,
    passed,
    passRate: total === 0 ? 0 : Number((passed / total).toFixed(3)),
    averageScore: Number(averageScore.toFixed(3)),
    averageDurationMs: Math.round(average(durations)),
    averageLlmRounds: Number(average(rounds).toFixed(2)),
    averageTotalTokens: Math.round(average(tokens)),
    retryRate: total === 0 ? 0 : Number((retried / total).toFixed(3)),
    failures: cases.filter((item) => !item.passed).map((item) => item.caseId)
  }
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}
