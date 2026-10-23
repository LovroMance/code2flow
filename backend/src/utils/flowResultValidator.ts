import { ZodError } from 'zod'
import { GenerationResultSchema } from '../domain/flow/schema'
import { schemaIssueMessage } from './errorMessage'

export function parseFlowGenerationResult(payload: unknown) {
  let result

  try {
    result = GenerationResultSchema.parse(payload)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(
        `模型输出不符合格式要求：${error.issues.map((issue) => schemaIssueMessage(issue.code, 'expected' in issue ? issue.expected : undefined)).join('；')}`
      )
    }

    throw error
  }

  validateNodeMappings(result.mermaid, result.mappings)
  return result
}

export function validateNodeMappings(mermaid: string, mappings: Array<{ nodeId: string }>) {
  const seenNodeIds = new Set<string>()

  for (const mapping of mappings) {
    if (seenNodeIds.has(mapping.nodeId)) {
      throw new Error(`发现重复的节点编号：${mapping.nodeId}`)
    }

    seenNodeIds.add(mapping.nodeId)

    const nodePattern = new RegExp(`\\b${escapeRegExp(mapping.nodeId)}\\b`)

    if (!nodePattern.test(mermaid)) {
      throw new Error(`源码映射对应的节点未出现在流程图中：${mapping.nodeId}`)
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
