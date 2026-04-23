import type { FlowGenerationResult, NodeMapping } from '../domain/flow/types'

export function normalizeFlowResultAgainstCode(
  code: string,
  result: FlowGenerationResult
): FlowGenerationResult {
  const lines = code.replace(/\r\n/g, '\n').split('\n')

  return {
    ...result,
    mappings: result.mappings.map((mapping) => normalizeMappingAgainstCode(lines, mapping))
  }
}

function normalizeMappingAgainstCode(lines: string[], mapping: NodeMapping): NodeMapping {
  const normalizedLineStart = findNearestExecutableLine(lines, mapping.lineStart)
  const normalizedLineEnd = Math.max(
    normalizedLineStart,
    findNearestExecutableLine(lines, mapping.lineEnd)
  )
  const lineChanged =
    normalizedLineStart !== mapping.lineStart || normalizedLineEnd !== mapping.lineEnd

  return {
    ...mapping,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
    columnStart: lineChanged ? undefined : mapping.columnStart,
    columnEnd: lineChanged ? undefined : mapping.columnEnd
  }
}

function findNearestExecutableLine(lines: string[], lineNumber: number) {
  const startIndex = clampLineIndex(lineNumber, lines.length)

  if (isExecutableLine(lines[startIndex])) {
    return startIndex + 1
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (isExecutableLine(lines[index])) {
      return index + 1
    }
  }

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (isExecutableLine(lines[index])) {
      return index + 1
    }
  }

  return startIndex + 1
}

function clampLineIndex(lineNumber: number, totalLines: number) {
  if (totalLines <= 0) {
    return 0
  }

  return Math.min(Math.max(lineNumber - 1, 0), totalLines - 1)
}

function isExecutableLine(line: string | undefined) {
  const trimmed = line?.trim() ?? ''

  if (!trimmed) {
    return false
  }

  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  ) {
    return false
  }

  if (trimmed === '{' || trimmed === '}' || trimmed === '};') {
    return false
  }

  return true
}
