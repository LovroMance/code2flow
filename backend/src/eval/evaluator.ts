import type { FlowGenerationResult, NodeMapping } from '../domain/flow/types'
import type { EvalCase } from './dataset.types'

// 单样例的评估结果。每个指标都带 pass/fail，便于聚合出通过率。
export interface CaseEvaluation {
  caseId: string
  caseName: string
  tags: string[]
  checks: EvalCheck[]
  passed: boolean
  score: number
  runId?: string
  durationMs?: number
  llmRounds?: number
  retryCount?: number
  totalTokens?: number
}

export interface EvalCheck {
  name: string
  passed: boolean
  detail: string
}

// 程序化评估：只做确定性判断，不依赖模型，因此结果可复现、可进 CI。
export function evaluateCase(input: {
  evalCase: EvalCase
  result: FlowGenerationResult
  code: string
}): CaseEvaluation {
  const { evalCase, result, code } = input
  const checks: EvalCheck[] = []

  checks.push(checkSchemaShape(result))
  checks.push(checkNodeMappingsConsistent(result))
  checks.push(checkLineRange(result, code))
  checks.push(checkKinds(result, evalCase))
  checks.push(checkLabels(result, evalCase))
  checks.push(checkMappingCount(result, evalCase))

  const passedCount = checks.filter((check) => check.passed).length
  const score = checks.length === 0 ? 0 : Number((passedCount / checks.length).toFixed(3))

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    tags: evalCase.tags,
    checks,
    passed: checks.every((check) => check.passed),
    score
  }
}

// 结构完整性：mermaid 非空且是 flowchart TD，mappings 是数组。
function checkSchemaShape(result: FlowGenerationResult): EvalCheck {
  const hasMermaid = typeof result.mermaid === 'string' && result.mermaid.trim().length > 0
  const isFlowchart = result.mermaid?.trim().startsWith('flowchart TD')
  const hasMappings = Array.isArray(result.mappings)

  return {
    name: 'schema 结构',
    passed: Boolean(hasMermaid && isFlowchart && hasMappings),
    detail: `mermaid=${hasMermaid} flowchartTD=${Boolean(isFlowchart)} mappings=${hasMappings}`
  }
}

// 映射一致性：nodeId 不重复，且每个 nodeId 都真实出现在 mermaid 源码里。
function checkNodeMappingsConsistent(result: FlowGenerationResult): EvalCheck {
  const seen = new Set<string>()
  const duplicates: string[] = []
  const missing: string[] = []

  for (const mapping of result.mappings ?? []) {
    if (seen.has(mapping.nodeId)) {
      duplicates.push(mapping.nodeId)
    }

    seen.add(mapping.nodeId)

    if (!new RegExp(`\\b${escapeRegExp(mapping.nodeId)}\\b`).test(result.mermaid ?? '')) {
      missing.push(mapping.nodeId)
    }
  }

  return {
    name: '映射一致性',
    passed: duplicates.length === 0 && missing.length === 0,
    detail: `重复=[${duplicates.join(',')}] 未在图中出现=[${missing.join(',')}]`
  }
}

// 行号合法性：lineStart/lineEnd 必须落在真实代码行范围内。
function checkLineRange(result: FlowGenerationResult, code: string): EvalCheck {
  const totalLines = code.replace(/\r\n/g, '\n').split('\n').length
  const invalid = (result.mappings ?? []).filter(
    (mapping) =>
      !Number.isInteger(mapping.lineStart) ||
      !Number.isInteger(mapping.lineEnd) ||
      mapping.lineStart < 1 ||
      mapping.lineEnd > totalLines ||
      mapping.lineEnd < mapping.lineStart
  )

  return {
    name: '行号合法性',
    passed: invalid.length === 0,
    detail: `总行数=${totalLines} 越界映射=[${invalid.map((item) => item.nodeId).join(',')}]`
  }
}

// 语义类型覆盖：期望出现的 kind 是否都出现了。
function checkKinds(result: FlowGenerationResult, evalCase: EvalCase): EvalCheck {
  const expected = evalCase.expectation.mustHaveKinds

  if (!expected || expected.length === 0) {
    return { name: '节点类型覆盖', passed: true, detail: '未约束' }
  }

  const actual = new Set((result.mappings ?? []).map((mapping) => mapping.kind))
  const missing = expected.filter((kind) => !actual.has(kind as NodeMapping['kind']))

  return {
    name: '节点类型覆盖',
    passed: missing.length === 0,
    detail: `期望=[${expected.join(',')}] 缺失=[${missing.join(',')}]`
  }
}

// 标签语义：关键业务词必须出现，且不能出现被禁词。
function checkLabels(result: FlowGenerationResult, evalCase: EvalCase): EvalCheck {
  const labels = (result.mappings ?? []).map((mapping) => `${mapping.label} ${mapping.description}`)
  const mustContain = evalCase.expectation.mustContainLabels ?? []
  const forbidden = evalCase.expectation.forbiddenLabels ?? []

  const missing = mustContain.filter(
    (keyword) => !labels.some((label) => label.toLowerCase().includes(keyword.toLowerCase()))
  )
  const hitForbidden = forbidden.filter((keyword) =>
    labels.some((label) => label.toLowerCase().includes(keyword.toLowerCase()))
  )

  return {
    name: '标签语义',
    passed: missing.length === 0 && hitForbidden.length === 0,
    detail: `缺失关键词=[${missing.join(',')}] 命中禁用词=[${hitForbidden.join(',')}]`
  }
}

// 映射数量区间：太少说明漏画，太多说明把语法当流程画了。
function checkMappingCount(result: FlowGenerationResult, evalCase: EvalCase): EvalCheck {
  const count = result.mappings?.length ?? 0
  const min = evalCase.expectation.minMappings ?? 0
  const max = evalCase.expectation.maxMappings ?? Number.POSITIVE_INFINITY

  return {
    name: '映射数量',
    passed: count >= min && count <= max,
    detail: `实际=${count} 期望区间=[${min}, ${max === Number.POSITIVE_INFINITY ? '∞' : max}]`
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
