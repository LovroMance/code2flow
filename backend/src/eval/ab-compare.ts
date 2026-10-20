import type { EvalRunReport } from './runner'

// A/B 对比结果：逐指标给出两组数值和差值，以及是否显著。
export interface AbComparison {
  labelA: string
  labelB: string
  configA: EvalRunReport['config']
  configB: EvalRunReport['config']
  configChanged: string[]
  metrics: AbMetric[]
  caseDiffs: AbCaseDiff[]
  verdict: string
}

export interface AbMetric {
  name: string
  valueA: number
  valueB: number
  delta: number
  // 越大越好还是越小越好，决定 delta 的方向解读。
  betterWhen: 'higher' | 'lower'
  improved: boolean
}

export interface AbCaseDiff {
  caseId: string
  caseName: string
  statusA: 'pass' | 'fail' | 'missing'
  statusB: 'pass' | 'fail' | 'missing'
  scoreA: number
  scoreB: number
  change: 'improved' | 'regressed' | 'unchanged'
  failedChecksA: string[]
  failedChecksB: string[]
}

// 对比两份报告。核心是逐样例找出"修复了什么 / 弄坏了什么"，而不是只看总通过率。
export function compareEvalReports(input: {
  reportA: EvalRunReport
  reportB: EvalRunReport
  labelA?: string
  labelB?: string
}): AbComparison {
  const { reportA, reportB } = input
  const labelA = input.labelA ?? reportA.config.configHash
  const labelB = input.labelB ?? reportB.config.configHash

  const caseMapA = new Map(reportA.cases.map((item) => [item.caseId, item]))
  const caseMapB = new Map(reportB.cases.map((item) => [item.caseId, item]))
  const allCaseIds = Array.from(new Set([...caseMapA.keys(), ...caseMapB.keys()]))

  const caseDiffs: AbCaseDiff[] = allCaseIds.map((caseId) => {
    const a = caseMapA.get(caseId)
    const b = caseMapB.get(caseId)
    const scoreA = a?.score ?? 0
    const scoreB = b?.score ?? 0
    const statusA = a ? (a.passed ? 'pass' : 'fail') : 'missing'
    const statusB = b ? (b.passed ? 'pass' : 'fail') : 'missing'
    const change = scoreB > scoreA ? 'improved' : scoreB < scoreA ? 'regressed' : 'unchanged'

    return {
      caseId,
      caseName: a?.caseName ?? b?.caseName ?? caseId,
      statusA,
      statusB,
      scoreA,
      scoreB,
      change,
      failedChecksA: (a?.checks ?? []).filter((check) => !check.passed).map((check) => check.name),
      failedChecksB: (b?.checks ?? []).filter((check) => !check.passed).map((check) => check.name)
    }
  })

  const metrics: AbMetric[] = [
    buildMetric('通过率', reportA.summary.passRate, reportB.summary.passRate, 'higher'),
    buildMetric('平均得分', reportA.summary.averageScore, reportB.summary.averageScore, 'higher'),
    buildMetric(
      '平均耗时(ms)',
      reportA.summary.averageDurationMs,
      reportB.summary.averageDurationMs,
      'lower'
    ),
    buildMetric(
      '平均模型轮次',
      reportA.summary.averageLlmRounds,
      reportB.summary.averageLlmRounds,
      'lower'
    ),
    buildMetric(
      '平均 Token',
      reportA.summary.averageTotalTokens ?? 0,
      reportB.summary.averageTotalTokens ?? 0,
      'lower'
    ),
    buildMetric('重试率', reportA.summary.retryRate, reportB.summary.retryRate, 'lower')
  ]

  return {
    labelA,
    labelB,
    configA: reportA.config,
    configB: reportB.config,
    configChanged: diffConfig(reportA.config, reportB.config),
    metrics,
    caseDiffs,
    verdict: buildVerdict(metrics, caseDiffs)
  }
}

function buildMetric(
  name: string,
  valueA: number,
  valueB: number,
  betterWhen: 'higher' | 'lower'
): AbMetric {
  const delta = Number((valueB - valueA).toFixed(3))
  const improved = betterWhen === 'higher' ? delta > 0 : delta < 0

  return { name, valueA, valueB, delta, betterWhen, improved }
}

// 列出两组之间真正变化的配置项，避免把"什么都没改"误判成实验。
function diffConfig(a: EvalRunReport['config'], b: EvalRunReport['config']) {
  const keys: Array<keyof EvalRunReport['config']> = [
    'provider',
    'promptVariant',
    'model',
    'temperature',
    'maxRetries'
  ]

  return keys
    .filter((key) => a[key] !== b[key])
    .map((key) => `${String(key)}: ${String(a[key])} → ${String(b[key])}`)
}

function buildVerdict(metrics: AbMetric[], caseDiffs: AbCaseDiff[]) {
  if (caseDiffs.length === 0) {
    return '无可对比样例'
  }

  const regressed = caseDiffs.filter((item) => item.change === 'regressed').length
  const improved = caseDiffs.filter((item) => item.change === 'improved').length
  const passRateMetric = metrics.find((metric) => metric.name === '通过率')
  const passRateDelta = passRateMetric?.delta ?? 0

  if (regressed > 0 && improved === 0) {
    return `B 组未带来任何改善，且回归 ${regressed} 个样例，建议回退`
  }

  if (passRateDelta > 0 && regressed === 0) {
    return `B 组通过率提升 ${(passRateDelta * 100).toFixed(1)}%，无回归，可以保留`
  }

  if (passRateDelta === 0 && improved > 0 && regressed > 0) {
    return `B 组通过率持平，但修复 ${improved} 个、弄坏 ${regressed} 个，属于等价替换，需人工判断取舍`
  }

  if (regressed > improved) {
    return `B 组通过率变化 ${(passRateDelta * 100).toFixed(1)}%，但回归数(${regressed})多于修复数(${improved})，不建议合入`
  }

  return `B 组通过率变化 ${(passRateDelta * 100).toFixed(1)}%，修复 ${improved} 个、回归 ${regressed} 个`
}

// 生成人类可读的 Markdown 对比报告，便于贴到 PR 或周报里。
export function renderAbMarkdown(comparison: AbComparison): string {
  const lines: string[] = []

  lines.push(`# Code2Flow A/B 评估对比`)
  lines.push('')
  lines.push(`- A 组：\`${comparison.labelA}\``)
  lines.push(`- B 组：\`${comparison.labelB}\``)
  lines.push('')

  if (comparison.configChanged.length > 0) {
    lines.push('## 配置差异')
    lines.push('')
    for (const change of comparison.configChanged) {
      lines.push(`- ${change}`)
    }
    lines.push('')
  } else {
    lines.push('> ⚠️ 两组配置完全一致，本次对比不构成有效实验。')
    lines.push('')
  }

  lines.push('## 指标对比')
  lines.push('')
  lines.push('| 指标 | A | B | 差值 | 方向 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const metric of comparison.metrics) {
    const arrow = metric.delta === 0 ? '—' : metric.improved ? '✅ 改善' : '❌ 变差'
    lines.push(
      `| ${metric.name} | ${metric.valueA} | ${metric.valueB} | ${metric.delta > 0 ? '+' : ''}${metric.delta} | ${arrow} |`
    )
  }
  lines.push('')

  lines.push('## 逐样例差异')
  lines.push('')
  lines.push('| 样例 | A | B | 变化 |')
  lines.push('| --- | --- | --- | --- |')
  for (const diff of comparison.caseDiffs) {
    const icon = diff.change === 'improved' ? '✅' : diff.change === 'regressed' ? '❌' : '—'
    lines.push(
      `| ${diff.caseName} | ${diff.statusA} (${diff.scoreA}) | ${diff.statusB} (${diff.scoreB}) | ${icon} ${diff.change} |`
    )
  }
  lines.push('')

  const regressions = comparison.caseDiffs.filter((item) => item.change === 'regressed')

  if (regressions.length > 0) {
    lines.push('## 回归明细（重点排查）')
    lines.push('')
    for (const item of regressions) {
      lines.push(`### ${item.caseName}`)
      lines.push('')
      lines.push(`- A 组失败项：${item.failedChecksA.join('、') || '无'}`)
      lines.push(`- B 组失败项：${item.failedChecksB.join('、') || '无'}`)
      lines.push('')
    }
  }

  lines.push('## 结论')
  lines.push('')
  lines.push(comparison.verdict)
  lines.push('')

  return lines.join('\n')
}
