import { ZodError } from 'zod'
import { GenerationResultSchema } from '../../domain/flow/schema'

export function parseCodeFlowResult(payload: unknown) {
  // 对模型结果做最终结构校验，并补充业务一致性检查。
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
  // 先把模型原始文本清洗成可解析的 JSON 字符串，再转成对象。
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
    // 解析成功后继续走统一的结构校验与业务校验。
    return parseCodeFlowResult(parsed)
  } catch (error) {
    // 校验失败时附带一段原始输出预览，方便定位模型返回问题。
    const preview = cleaned.slice(0, 600)
    const message = error instanceof Error ? error.message : 'Unknown parser error'

    throw new Error(`${message}. Raw output preview: ${preview}`)
  }
}

export function extractPartialMermaid(rawText: string) {
  const mermaidValue = extractJsonStringField(rawText, 'mermaid')

  if (!mermaidValue) {
    return ''
  }

  const normalized = mermaidValue.value.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const stableLines = mermaidValue.closed ? lines : lines.slice(0, -1)

  if (stableLines.length < 2) {
    return ''
  }

  return stableLines.join('\n').trim()
}

function cleanJsonText(rawText: string) {
  // 清理 markdown code fence，并尽量只保留 JSON 对象主体。
  const trimmed = rawText.trim()
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
  const jsonObject = extractJsonObject(withoutFence)

  return jsonObject.trim()
}

function extractJsonObject(input: string) {
  // 从混杂文本里截出最外层 JSON 对象，避免前后杂质影响 JSON.parse。
  const start = input.indexOf('{')
  const end = input.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output does not contain a valid JSON object')
  }

  return input.slice(start, end + 1)
}

function validateNodeMappings(mermaid: string, mappings: Array<{ nodeId: string }>) {
  // 额外校验 mappings 和 Mermaid 图之间是否一致。
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

function extractJsonStringField(input: string, fieldName: string) {
  const fieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`, 'm')
  const match = fieldPattern.exec(input)

  if (!match) {
    return null
  }

  let cursor = match.index + match[0].length
  let value = ''
  let closed = false

  while (cursor < input.length) {
    const current = input[cursor]

    if (current === '"') {
      closed = true
      break
    }

    if (current === '\\') {
      const next = input[cursor + 1]

      if (!next) {
        break
      }

      if (next === 'n') {
        value += '\n'
      } else if (next === 'r') {
        value += '\r'
      } else if (next === 't') {
        value += '\t'
      } else if (next === '"' || next === '\\' || next === '/') {
        value += next
      } else {
        value += next
      }

      cursor += 2
      continue
    }

    value += current
    cursor += 1
  }

  return {
    value,
    closed
  }
}

function escapeRegExp(value: string) {
  // 转义 nodeId，避免拼正则时被特殊字符干扰。
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
