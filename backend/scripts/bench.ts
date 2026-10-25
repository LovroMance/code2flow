/**
 * 多文件分析基准：在固定样本集上运行完整 v2 流程，输出调用数、token 用量与耗时。
 * 用法：npm run bench -- <label> [reps] [samples]  ；本地测量，不上传 LangSmith。
 * 基线与优化后必须使用同一样本与参数对比，JSON 结果写入 .code2flow/bench/。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface RunRecord {
  sample: string
  rep: number
  ok: boolean
  error?: string
  durationMs: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  mappings: number
  mermaidChars: number
  coverageComplete: boolean | null
}

function loadSample(name: string) {
  const dir = path.join(__dirname, 'bench', 'samples', name)
  return readdirSync(dir)
    .filter((file) => !file.startsWith('.'))
    .sort()
    .map((file) => ({ path: file, content: readFileSync(path.join(dir, file), 'utf8') }))
}

// complete 事件的 usage 即 runtime.budget()；从中提取逐次调用数组。
function extractUsage(events: Array<{ type: string; content?: unknown }>) {
  const complete = [...events].reverse().find((event) => {
    const content = event.content as { stage?: string } | undefined
    return event.type === 'metadata' && content?.stage === 'complete'
  })
  const usage = (complete?.content as { usage?: { usage?: unknown } } | undefined)?.usage
  const calls = Array.isArray(usage?.usage) ? (usage!.usage as Array<Record<string, unknown>>) : []
  return {
    calls: calls.length,
    inputTokens: calls.reduce((n, c) => n + (typeof c.input === 'number' ? c.input : 0), 0),
    outputTokens: calls.reduce((n, c) => n + (typeof c.output === 'number' ? c.output : 0), 0),
    cacheReadTokens: calls.reduce(
      (n, c) => n + (typeof c.cacheRead === 'number' ? c.cacheRead : 0),
      0
    )
  }
}

async function runOnce(
  serviceModules: { SessionService: any; MultiFileService: any },
  saver: any,
  sample: string,
  rep: number
): Promise<RunRecord> {
  const sessionId = `bench-${sample}-${rep}`
  try {
    const sessions = new serviceModules.SessionService(saver)
    await sessions.create({ id: sessionId })
    const service = new serviceModules.MultiFileService(saver)
    const snapshot = await service.createSnapshot(sessionId, loadSample(sample))
    const events: Array<{ type: string; content?: unknown }> = []
    const startedAt = Date.now()
    try {
      const result = await service.generate(
        sessionId,
        snapshot.snapshotId,
        new AbortController().signal,
        (type: string, content?: unknown) => events.push({ type, content })
      )
      return {
        sample,
        rep,
        ok: true,
        durationMs: Date.now() - startedAt,
        ...extractUsage(events),
        mappings: result.mappings.length,
        mermaidChars: result.mermaid.length,
        coverageComplete: result.coverage.complete
      }
    } catch (error) {
      return {
        sample,
        rep,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        durationMs: Date.now() - startedAt,
        ...extractUsage(events),
        mappings: 0,
        mermaidChars: 0,
        coverageComplete: null
      }
    }
  } catch (error) {
    return {
      sample,
      rep,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      durationMs: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      mappings: 0,
      mermaidChars: 0,
      coverageComplete: null
    }
  }
}

async function main() {
  // 本地测量：关闭云端追踪，避免上传噪声影响耗时。
  process.env.LANGSMITH_TRACING = 'false'
  process.env.LANGCHAIN_TRACING_V2 = 'false'
  const { config } = await import('dotenv')
  config()
  const { SqliteSaver } = await import('@langchain/langgraph-checkpoint-sqlite')
  const { SessionService } = await import('../src/services/session.service')
  const { MultiFileService } = await import('../src/services/multifile.service')

  const label = process.argv[2] ?? 'run'
  const reps = Math.max(1, Number(process.argv[3] ?? 2))
  const samples = process.argv[4] ? process.argv[4].split(',') : ['small', 'medium']
  const runs: RunRecord[] = []
  for (const sample of samples) {
    // 同一样本的多次运行共享一个内存库：rep1 为冷缓存，rep2+ 度量跨会话复用收益。
    const saver = SqliteSaver.fromConnString(':memory:')
    try {
      for (let rep = 1; rep <= reps; rep++) {
        process.stdout.write(`[${label}] ${sample} #${rep} ... `)
        const record = await runOnce({ SessionService, MultiFileService }, saver, sample, rep)
        runs.push(record)
        console.log(
          record.ok
            ? `ok ${record.durationMs}ms calls=${record.calls} in=${record.inputTokens} out=${record.outputTokens} mappings=${record.mappings}`
            : `FAILED ${record.durationMs}ms ${record.error}`
        )
      }
    } finally {
      saver.db.close()
    }
  }
  const ok = runs.filter((r) => r.ok)
  const summary = {
    label,
    capturedAt: new Date().toISOString(),
    reps,
    samples,
    totals: {
      runs: ok.length,
      failures: runs.length - ok.length,
      durationMs: ok.reduce((n, r) => n + r.durationMs, 0),
      calls: ok.reduce((n, r) => n + r.calls, 0),
      inputTokens: ok.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: ok.reduce((n, r) => n + r.outputTokens, 0),
      cacheReadTokens: ok.reduce((n, r) => n + r.cacheReadTokens, 0)
    },
    runs
  }
  const outDir = path.join(__dirname, '..', '.code2flow', 'bench')
  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${label}.json`)
  writeFileSync(file, JSON.stringify(summary, null, 2))
  console.log(
    `\n汇总[${label}]: 调用=${summary.totals.calls} 输入=${summary.totals.inputTokens} 输出=${summary.totals.outputTokens} 缓存命中=${summary.totals.cacheReadTokens} 耗时=${summary.totals.durationMs}ms 失败=${summary.totals.failures}`
  )
  console.log(`结果已写入 ${file}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
