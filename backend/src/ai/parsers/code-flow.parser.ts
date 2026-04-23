import { ZodError } from 'zod'
import { GenerationResultSchema } from '../../domain/flow/schema'

export function parseCodeFlowResult(payload: unknown) {
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

export function parseCodeFlowTextResult(rawText: string) {
  const cleaned = cleanJsonText(rawText)

  let parsed: unknown

  try {
    parsed = JSON.parse(cleaned)
  } catch (error) {
    throw new Error(
      `Failed to parse model JSON output: ${error instanceof Error ? error.message : 'Unknown JSON error'}`
    )
  }

  try {
    return parseCodeFlowResult(parsed)
  } catch (error) {
    const preview = cleaned.slice(0, 600)
    const message = error instanceof Error ? error.message : 'Unknown parser error'

    throw new Error(`${message}. Raw output preview: ${preview}`)
  }
}

function cleanJsonText(rawText: string) {
  const trimmed = rawText.trim()
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
  const jsonObject = extractJsonObject(withoutFence)

  return jsonObject.trim()
}

function extractJsonObject(input: string) {
  const start = input.indexOf('{')
  const end = input.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output does not contain a valid JSON object')
  }

  return input.slice(start, end + 1)
}

function validateNodeMappings(mermaid: string, mappings: Array<{ nodeId: string }>) {
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
