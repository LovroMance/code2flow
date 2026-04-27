import { ZodError } from 'zod'
import { GenerationResultSchema } from '../domain/flow/schema'

export function parseFlowGenerationResult(payload: unknown) {
  let result

  try {
    result = GenerationResultSchema.parse(payload)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Model output does not match schema: ${JSON.stringify(error.issues)}`)
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
      throw new Error(`Duplicate nodeId detected: ${mapping.nodeId}`)
    }

    seenNodeIds.add(mapping.nodeId)

    const nodePattern = new RegExp(`\\b${escapeRegExp(mapping.nodeId)}\\b`)

    if (!nodePattern.test(mermaid)) {
      throw new Error(`Mapping nodeId is missing from Mermaid: ${mapping.nodeId}`)
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
