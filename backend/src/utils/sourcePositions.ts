import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { SourceRange } from '../domain/source/schema'

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
/** 统一工作区相对路径并拒绝越界路径，供文件去重及关系解析使用。 */
export function normalizeSourcePath(input: string) {
  const path = input.replace(/\\/g, '/')
  if (/^(?:\/|[a-z]:)/i.test(path) || [...path].some((c) => c.charCodeAt(0) < 32))
    throw new Error('文件路径必须是项目内相对路径。')
  let depth = 0
  for (const part of path.split('/')) {
    if (part === '..') {
      if (--depth < 0) throw new Error('文件路径不能越界。')
    } else if (part && part !== '.') depth++
  }
  const normalized = posix.normalize(path)
  if (normalized === '.' || normalized.endsWith('/')) throw new Error('文件路径无效。')
  return normalized
}
// 保留原始 CRLF、BOM 与 UTF-16 偏移；不在代理对中间建立边界。
/** 建立每行起始 UTF-16 偏移，不改写原始换行，后续行列转换复用该表。 */
export function lineOffsets(text: string) {
  const offsets = [0]
  const endings = /\r\n|\r|\n/g
  for (let match = endings.exec(text); match; match = endings.exec(text))
    offsets.push(match.index + match[0].length)
  return offsets
}
/** 避免在 UTF-16 代理对或 CRLF 中间截断，保持切片与原始行列一致。 */
export function safeBoundary(text: string, offset: number) {
  if (offset > 0 && text[offset - 1] === '\r' && text[offset] === '\n') return offset - 1
  return offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[offset]!)
    ? offset - 1
    : offset
}
/** 将原始半开偏移转换为文件范围；使用 1 起始行列，结束列仍排他。 */
export function sourceRange(
  fileId: string,
  text: string,
  startOffset: number,
  endOffset: number,
  offsets = lineOffsets(text)
): SourceRange {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > text.length ||
    safeBoundary(text, startOffset) !== startOffset ||
    safeBoundary(text, endOffset) !== endOffset
  )
    throw new Error('原始源码范围无效。')
  const position = (offset: number) => {
    let lo = 0,
      hi = offsets.length
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[mid]! <= offset) lo = mid
      else hi = mid
    }
    return { line: lo + 1, column: offset - offsets[lo]! + 1 }
  }
  const start = position(startOffset),
    end = position(endOffset)
  return {
    fileId,
    startOffset,
    endOffset,
    lineStart: start.line,
    lineEnd: end.line,
    columnStart: start.column,
    columnEnd: end.column
  }
}
/** 从原文重新计算行列并比较，不静默修正模型返回的越界或错位位置。 */
export function validateSourceRange(
  range: SourceRange,
  fileId: string,
  text: string,
  offsets = lineOffsets(text)
) {
  const canonical = sourceRange(fileId, text, range.startOffset, range.endOffset, offsets)
  if (
    Object.keys(canonical).some(
      (key) => canonical[key as keyof SourceRange] !== range[key as keyof SourceRange]
    )
  )
    throw new Error('源码偏移与行列不一致，禁止修正越界映射。')
}
/** 对外使用首尾都包含的原始行号，内部范围仍以字符偏移的排他终点表示。 */
export function coveredLines(range: Pick<SourceRange, 'lineStart' | 'lineEnd' | 'columnEnd'>) {
  return {
    lineStart: range.lineStart,
    lineEnd: range.lineEnd - Number(range.columnEnd === 1 && range.lineEnd > range.lineStart)
  }
}

export function sourceLineRange(
  fileId: string,
  text: string,
  lineStart: number,
  lineEnd: number,
  offsets = lineOffsets(text)
) {
  const start = offsets[lineStart - 1]
  const last = offsets[lineEnd - 1]
  if (start === undefined || last === undefined || lineEnd < lineStart || last === text.length)
    throw new Error(`源码行范围无效：第 ${lineStart}–${lineEnd} 行。`)
  return sourceRange(fileId, text, start, offsets[lineEnd] ?? text.length, offsets)
}
export function languageSample(files: Array<{ path: string; content: string }>) {
  const file = [...files].sort(
    (a, b) => b.content.trim().length - a.content.trim().length || a.path.localeCompare(b.path)
  )[0]!
  if (file.content.length <= 16000) return file.content
  const lines = lineOffsets(file.content)
  const width = Math.floor((16000 - 3 * (file.path.length + 100)) / 3)
  return [0, Math.floor(file.content.length / 2), file.content.length - width]
    .map((at) => {
      const start =
        lines.find((offset) => offset >= at && offset <= at + width / 4) ??
        safeBoundary(file.content, at)
      let end = Math.min(start + width, file.content.length)
      end =
        [...lines].reverse().find((offset) => offset <= end && offset > start) ??
        safeBoundary(file.content, end)
      return `[${file.path} 原始偏移 ${start}:${end}，源码片段]\n${file.content.slice(start, end)}`
    })
    .join('\n')
}
