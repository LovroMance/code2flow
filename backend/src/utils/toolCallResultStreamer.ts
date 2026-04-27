import { normalizeMermaidSource } from './mermaidNormalizer'

export function extractPartialMermaidFromToolArgs(rawArgs: string) {
  const mermaidValue = extractJsonStringField(rawArgs, 'mermaid')

  if (!mermaidValue) {
    return ''
  }

  const normalized = mermaidValue.value.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const stableLines = mermaidValue.closed ? lines : lines.slice(0, -1)

  if (stableLines.length < 2) {
    return ''
  }

  return normalizeMermaidSource(stableLines.join('\n').trim())
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
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
