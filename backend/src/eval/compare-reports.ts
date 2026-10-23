import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compareEvalReports, renderAbMarkdown } from './ab-compare'
import type { EvalRunReport } from './runner'
import { chineseErrorMessage } from '../utils/errorMessage'

// A/B 对比入口：读两份报告，输出 Markdown 对比结论。
// 用法：npx tsx src/eval/compare-reports.ts --a <a.json> --b <b.json> [--out ab.md]
async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.a || !args.b) {
    console.error('用法: npx tsx src/eval/compare-reports.ts --a <报告A> --b <报告B> [--out ab.md]')
    process.exitCode = 1
    return
  }

  const reportA = await readReport(args.a)
  const reportB = await readReport(args.b)

  const comparison = compareEvalReports({
    reportA,
    reportB,
    labelA: args['label-a'],
    labelB: args['label-b']
  })

  const markdown = renderAbMarkdown(comparison)
  console.log(markdown)

  const outPath = resolve(args.out ?? '.code2flow/eval/ab-comparison.md')
  await writeFile(outPath, markdown, 'utf8')
  console.log(`[ab] 对比报告已写入 ${outPath}`)
}

async function readReport(path: string): Promise<EvalRunReport> {
  const raw = await readFile(resolve(path), 'utf8')
  return JSON.parse(raw) as EvalRunReport
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
  console.error('[ab] 报告对比失败：', chineseErrorMessage(error))
  process.exitCode = 1
})
