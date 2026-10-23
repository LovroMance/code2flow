import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { baselineDataset } from './datasets/baseline.dataset'
import { runEvalDataset } from './runner'
import { chineseErrorMessage } from '../utils/errorMessage'

// CLI 脚本不经过 src/index.ts，必须自己加载 .env，否则 provider / model 会静默回退成默认值。
loadEnv({ path: resolve(process.cwd(), '.env') })

// 评估跑批入口：一条命令跑完数据集并落盘报告。
// 用法：npx tsx src/eval/run-baseline.ts --label baseline-v1 [--concurrency 2] [--limit 2]
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const label = args.label ?? 'baseline'
  const concurrency = args.concurrency ? Number(args.concurrency) : 1
  const outputDir = resolve(args.out ?? '.code2flow/eval')

  // --limit 用于冒烟验证：只跑前 N 条，避免调 prompt 时反复消耗全量额度。
  const dataset = args.limit
    ? { ...baselineDataset, cases: baselineDataset.cases.slice(0, Number(args.limit)) }
    : baselineDataset

  console.log(`[eval] dataset=${dataset.name} cases=${dataset.cases.length}`)
  console.log(`[eval] label=${label} concurrency=${concurrency} outputDir=${outputDir}`)

  const startedAt = Date.now()
  const { report, reportPath } = await runEvalDataset({
    dataset,
    outputDir,
    label,
    concurrency
  })

  for (const item of report.cases) {
    const icon = item.passed ? 'PASS' : 'FAIL'
    const failed = item.checks.filter((check) => !check.passed).map((check) => check.name)
    console.log(
      `[eval] ${icon} ${item.caseId} score=${item.score} duration=${item.durationMs ?? 0}ms` +
        (failed.length > 0 ? ` failed=[${failed.join(',')}]` : '')
    )
  }

  console.log('')
  console.log(`[eval] total=${report.summary.total} passed=${report.summary.passed}`)
  console.log(
    `[eval] passRate=${report.summary.passRate} averageScore=${report.summary.averageScore}`
  )
  console.log(
    `[eval] avgDuration=${report.summary.averageDurationMs}ms avgRounds=${report.summary.averageLlmRounds}`
  )
  console.log(`[eval] retryRate=${report.summary.retryRate}`)

  if (report.summary.failures.length > 0) {
    console.log(`[eval] failures=[${report.summary.failures.join(',')}]`)
  }

  console.log('')
  console.log(`[eval] configHash=${report.config.configHash}`)
  console.log(`[eval] report=${reportPath}`)
  console.log(`[eval] elapsed=${Date.now() - startedAt}ms`)
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
  console.error('[eval] 评估执行失败：', chineseErrorMessage(error))
  process.exitCode = 1
})
