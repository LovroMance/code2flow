import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RunTrace } from '../ai/observability/trace.types'

// 轨迹聚合入口：把 runs.jsonl 汇总成一张观察报表。
// 用法：npx tsx src/eval/analyze-traces.ts [--file .code2flow/traces/runs.jsonl]
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const filePath = resolve(
    args.file ?? process.env.CODE2FLOW_TRACE_FILE ?? '.code2flow/traces/runs.jsonl'
  )

  if (!existsSync(filePath)) {
    console.log(`[traces] 轨迹文件不存在：${filePath}`)
    console.log('[traces] 先启动服务跑几次请求，或执行 npm run eval 生成轨迹。')
    return
  }

  const traces = await loadTraces(filePath)

  if (traces.length === 0) {
    console.log('[traces] 文件为空')
    return
  }

  printOverview(traces)
  printByConfig(traces)
  printStepTimings(traces)
  printFailures(traces)
}

async function loadTraces(filePath: string): Promise<RunTrace[]> {
  const raw = await readFile(filePath, 'utf8')

  // JSONL 逐行解析：单行损坏不影响整体，跳过并计数。
  const traces: RunTrace[] = []
  let broken = 0

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }

    try {
      traces.push(JSON.parse(line) as RunTrace)
    } catch {
      broken += 1
    }
  }

  if (broken > 0) {
    console.log(`[traces] 跳过 ${broken} 行无法解析的记录`)
  }

  return traces
}

function printOverview(traces: RunTrace[]) {
  const success = traces.filter((trace) => trace.outcome === 'success')
  const durations = traces.map((trace) => trace.durationMs)
  const rounds = traces.map((trace) => trace.usage.llmRounds)
  const tokens = traces.map((trace) => trace.usage.totalTokens)
  const retried = traces.filter((trace) => trace.usage.retryCount > 0)

  console.log('=== 总览 ===')
  console.log(`运行次数        ${traces.length}`)
  console.log(`成功率          ${percent(success.length, traces.length)}`)
  console.log(`耗时 P50 / P95  ${percentile(durations, 0.5)}ms / ${percentile(durations, 0.95)}ms`)
  console.log(`模型轮次均值    ${average(rounds).toFixed(2)}`)
  console.log(`Token 均值      ${Math.round(average(tokens))}`)
  console.log(`触发重试比例    ${percent(retried.length, traces.length)}`)
  console.log(`时间范围        ${traces[0].startedAt} ~ ${traces[traces.length - 1].finishedAt}`)
  console.log('')
}

// 按配置指纹分组：这是判断"哪个版本更好"的核心视角。
function printByConfig(traces: RunTrace[]) {
  const groups = new Map<string, RunTrace[]>()

  for (const trace of traces) {
    const key = trace.config.configHash
    const list = groups.get(key) ?? []
    list.push(trace)
    groups.set(key, list)
  }

  console.log('=== 按配置分组 ===')
  console.log(
    '| configHash | provider | variant | model | temp | 次数 | 成功率 | P50耗时 | 平均轮次 |'
  )
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')

  for (const [hash, list] of groups) {
    const { config } = list[0]
    const ok = list.filter((trace) => trace.outcome === 'success').length
    const p50 = percentile(
      list.map((trace) => trace.durationMs),
      0.5
    )
    const avgRounds = average(list.map((trace) => trace.usage.llmRounds)).toFixed(2)

    console.log(
      `| ${hash} | ${config.provider} | ${config.promptVariant} | ${config.model} | ${config.temperature} | ${list.length} | ${percent(ok, list.length)} | ${p50}ms | ${avgRounds} |`
    )
  }

  console.log('')
}

// 节点耗时分布：直接指出瓶颈在哪个环节。
function printStepTimings(traces: RunTrace[]) {
  const stats = new Map<string, { count: number; total: number; failed: number }>()

  for (const trace of traces) {
    for (const step of trace.steps) {
      // 去掉 #0 / #1 这类重试后缀，把同名节点聚合到一起。
      const name = step.name.replace(/#\d+$/, '')
      const entry = stats.get(name) ?? { count: 0, total: 0, failed: 0 }
      entry.count += 1
      entry.total += step.durationMs
      entry.failed += step.ok ? 0 : 1
      stats.set(name, entry)
    }
  }

  console.log('=== 节点耗时（均值） ===')

  const sorted = Array.from(stats.entries()).sort(
    (left, right) => right[1].total / right[1].count - left[1].total / left[1].count
  )

  for (const [name, entry] of sorted) {
    const failureNote = entry.failed > 0 ? ` 失败 ${entry.failed} 次` : ''
    console.log(
      `${name.padEnd(20)} ${Math.round(entry.total / entry.count)}ms  执行 ${entry.count} 次${failureNote}`
    )
  }

  console.log('')
}

function printFailures(traces: RunTrace[]) {
  const failed = traces.filter((trace) => trace.outcome === 'error')

  if (failed.length === 0) {
    console.log('=== 失败记录 === 无')
    return
  }

  console.log(`=== 失败记录（${failed.length} 条） ===`)

  // 错误信息按出现频次聚合，便于判断是偶发还是系统性缺陷。
  const counter = new Map<string, number>()

  for (const trace of failed) {
    const message = (trace.error ?? 'unknown').slice(0, 120)
    counter.set(message, (counter.get(message) ?? 0) + 1)
  }

  for (const [message, count] of Array.from(counter.entries()).sort(
    (left, right) => right[1] - left[1]
  )) {
    console.log(`  ${count}× ${message}`)
  }

  const validationFailures = failed.filter((trace) => trace.usage.validationErrors.length > 0)

  if (validationFailures.length > 0) {
    console.log('')
    console.log('  校验失败原因：')

    for (const trace of validationFailures.slice(0, 10)) {
      console.log(`    ${trace.runId} -> ${trace.usage.validationErrors.join(' | ').slice(0, 120)}`)
    }
  }
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))
  return sorted[index]
}

function percent(part: number, total: number) {
  return total === 0 ? '0%' : `${((part / total) * 100).toFixed(1)}%`
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (!token.startsWith('--')) {
      continue
    }

    const key = token.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
      continue
    }

    parsed[key] = next
    index += 1
  }

  return parsed
}

main().catch((error) => {
  console.error('[traces] failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
