import { describe, expect, it } from 'vitest'
import type { FlowGenerationResult } from '../src/domain/flow/types'
import { evaluateCase } from '../src/eval/evaluator'
import { compareEvalReports, renderAbMarkdown } from '../src/eval/ab-compare'
import type { EvalCase } from '../src/eval/dataset.types'
import type { EvalRunReport } from '../src/eval/runner'

function buildCase(overrides?: Partial<EvalCase>): EvalCase {
  return {
    id: 'case-1',
    name: '样例一',
    language: 'javascript',
    tags: ['test'],
    code: 'function a() {\n  return 1\n}',
    expectation: {
      mustHaveKinds: ['return'],
      minMappings: 1,
      validLineRange: true
    },
    ...overrides
  }
}

function buildResult(overrides?: Partial<FlowGenerationResult>): FlowGenerationResult {
  return {
    detectedLanguage: 'javascript',
    mermaid: 'flowchart TD\n  n1 --> n2',
    mappings: [
      {
        nodeId: 'n1',
        kind: 'start',
        label: '开始',
        description: '函数入口',
        lineStart: 1,
        lineEnd: 1
      },
      {
        nodeId: 'n2',
        kind: 'return',
        label: '返回 1',
        description: '返回结果',
        lineStart: 2,
        lineEnd: 2
      }
    ],
    ...overrides
  }
}

describe('eval / evaluator', () => {
  it('passes when all checks are satisfied', () => {
    const evaluation = evaluateCase({
      evalCase: buildCase(),
      result: buildResult(),
      code: 'function a() {\n  return 1\n}'
    })

    expect(evaluation.passed).toBe(true)
    expect(evaluation.score).toBe(1)
  })

  it('fails when an expected node kind is missing', () => {
    const evaluation = evaluateCase({
      evalCase: buildCase({ expectation: { mustHaveKinds: ['decision'], minMappings: 1 } }),
      result: buildResult(),
      code: 'function a() {\n  return 1\n}'
    })

    expect(evaluation.passed).toBe(false)
    expect(evaluation.checks.find((check) => check.name === '节点类型覆盖')?.passed).toBe(false)
  })

  it('fails when a mapping points outside the code range', () => {
    const evaluation = evaluateCase({
      evalCase: buildCase({ expectation: { minMappings: 1 } }),
      result: buildResult({
        mappings: [
          {
            nodeId: 'n1',
            kind: 'start',
            label: '开始',
            description: '入口',
            lineStart: 99,
            lineEnd: 99
          }
        ]
      }),
      code: 'function a() {\n  return 1\n}'
    })

    expect(evaluation.checks.find((check) => check.name === '行号合法性')?.passed).toBe(false)
  })

  it('fails when a mapping nodeId never appears in the mermaid source', () => {
    const evaluation = evaluateCase({
      evalCase: buildCase({ expectation: { minMappings: 1 } }),
      result: buildResult({
        mermaid: 'flowchart TD\n  n1 --> n2',
        mappings: [
          {
            nodeId: 'n1',
            kind: 'start',
            label: '开始',
            description: '入口',
            lineStart: 1,
            lineEnd: 1
          },
          {
            nodeId: 'ghost',
            kind: 'return',
            label: '返回',
            description: '幽灵节点',
            lineStart: 2,
            lineEnd: 2
          }
        ]
      }),
      code: 'function a() {\n  return 1\n}'
    })

    expect(evaluation.checks.find((check) => check.name === '映射一致性')?.passed).toBe(false)
  })

  it('fails when required label keywords are absent', () => {
    const evaluation = evaluateCase({
      evalCase: buildCase({ expectation: { mustContainLabels: ['用户'], minMappings: 1 } }),
      result: buildResult(),
      code: 'function a() {\n  return 1\n}'
    })

    expect(evaluation.checks.find((check) => check.name === '标签语义')?.passed).toBe(false)
  })
})

describe('eval / ab-compare', () => {
  function buildReport(
    overrides: Partial<EvalRunReport> & { passRate: number; caseScores: number[] }
  ): EvalRunReport {
    return {
      datasetName: 'baseline',
      config: {
        provider: 'graph',
        promptVariant: 'baseline',
        model: 'deepseek-chat',
        temperature: 0,
        maxRetries: 1,
        configHash: 'aaaaaaaaaaaa'
      },
      startedAt: '2026-10-19T00:00:00.000Z',
      finishedAt: '2026-10-19T00:01:00.000Z',
      durationMs: 60000,
      cases: overrides.caseScores.map((score, index) => ({
        caseId: `case-${index}`,
        caseName: `样例${index}`,
        tags: [],
        checks: score === 1 ? [] : [{ name: '映射数量', passed: false, detail: 'too few' }],
        passed: score === 1,
        score
      })),
      summary: {
        total: overrides.caseScores.length,
        passed: overrides.caseScores.filter((score) => score === 1).length,
        passRate: overrides.passRate,
        averageScore: 0,
        averageDurationMs: 1000,
        averageLlmRounds: 2,
        averageTotalTokens: 1000,
        retryRate: 0,
        failures: []
      },
      ...overrides
    } as EvalRunReport
  }

  it('detects improvements and reports the pass-rate delta', () => {
    const reportA = buildReport({ passRate: 0.5, caseScores: [1, 0] })
    const reportB = buildReport({ passRate: 1, caseScores: [1, 1] })

    const comparison = compareEvalReports({ reportA, reportB })

    expect(comparison.metrics.find((metric) => metric.name === '通过率')?.delta).toBe(0.5)
    expect(comparison.caseDiffs[1].change).toBe('improved')
    expect(comparison.verdict).toContain('无回归')
  })

  it('detects regressions and warns against merging', () => {
    const reportA = buildReport({ passRate: 1, caseScores: [1, 1] })
    const reportB = buildReport({ passRate: 0.5, caseScores: [0, 0] })

    const comparison = compareEvalReports({ reportA, reportB })

    expect(comparison.caseDiffs.every((diff) => diff.change === 'regressed')).toBe(true)
    expect(comparison.verdict).toContain('建议回退')
  })

  it('flags an invalid experiment when the config did not change', () => {
    const reportA = buildReport({ passRate: 1, caseScores: [1] })
    const reportB = buildReport({ passRate: 1, caseScores: [1] })

    const comparison = compareEvalReports({ reportA, reportB })
    const markdown = renderAbMarkdown(comparison)

    expect(comparison.configChanged).toEqual([])
    expect(markdown).toContain('不构成有效实验')
  })

  it('lists changed config keys when the variant differs', () => {
    const reportA = buildReport({ passRate: 1, caseScores: [1] })
    const reportB = buildReport({ passRate: 1, caseScores: [1] })
    reportB.config = { ...reportB.config, promptVariant: 'v2', temperature: 0.3 }

    const comparison = compareEvalReports({ reportA, reportB })

    expect(comparison.configChanged).toHaveLength(2)
    expect(comparison.configChanged.join(' ')).toContain('promptVariant')
  })

  it('renders a markdown table with all metrics', () => {
    const reportA = buildReport({ passRate: 0.5, caseScores: [1, 0] })
    const reportB = buildReport({ passRate: 1, caseScores: [1, 1] })

    const markdown = renderAbMarkdown(compareEvalReports({ reportA, reportB }))

    expect(markdown).toContain('| 指标 | A | B | 差值 | 方向 |')
    expect(markdown).toContain('通过率')
    expect(markdown).toContain('逐样例差异')
  })
})
