import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { SourceRange, CodeChunk } from '../domain/source/schema'

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
export function chunkerVersion(maxChars: number, maxLines: number) {
  return `lines${maxLines}-overlap${Math.min(20, Math.floor(maxLines / 3))}-chars${maxChars}-v2`
}

/** 仅在创建或读取分块时检查一次；允许重叠，但必须有序、有效且覆盖原文全部字符。 */
export function validateChunks(fileId: string, text: string, chunks: CodeChunk[]) {
  const offsets = lineOffsets(text)
  let covered = 0
  let previousStart = -1
  for (const chunk of chunks) {
    validateSourceRange(chunk, fileId, text, offsets)
    if (
      chunk.startOffset <= previousStart ||
      chunk.startOffset > covered ||
      chunk.endOffset <= covered
    )
      throw new Error('分块实现错误：源码范围无序、存在缺口或未向后推进。')
    covered = chunk.endOffset
    previousStart = chunk.startOffset
  }
  if (covered !== text.length) throw new Error('分块实现错误：没有完整覆盖原始源码。')
}

/** 使用原文偏移切片；保留少量重叠供跨块边界识别，不改写原始正文。 */
export function chunkSource(
  fileId: string,
  text: string,
  maxChars = 8000,
  maxLines = 120
): CodeChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 2 || !Number.isInteger(maxLines) || maxLines < 2)
    throw new Error('分块配置无效：字符数和行数上限必须为至少2的整数。')
  const lines = lineOffsets(text),
    chunks: CodeChunk[] = []
  const contentHash = sha256(text)
  let start = 0
  while (start < text.length) {
    const line = sourceRange(fileId, text, start, text.length, lines).lineStart - 1
    let end = Math.min(lines[line + maxLines] ?? text.length, start + maxChars, text.length)
    end = safeBoundary(text, end)
    if (end < text.length) {
      const candidates = lines
        .slice(line + Math.floor((maxLines * 2) / 3), line + maxLines + 1)
        .filter(
          (offset) => offset > start && offset <= end && /^\s*(?:\r?\n|\r)/.test(text.slice(offset))
        )
      if (candidates.length) end = candidates[candidates.length - 1]!
    }
    chunks.push({
      ...sourceRange(fileId, text, start, end, lines),
      chunkId: `${fileId}_c${chunks.length}`,
      contentHash,
      chunkerVersion: chunkerVersion(maxChars, maxLines)
    })
    if (end === text.length) break
    const endLine = sourceRange(fileId, text, start, end, lines).lineEnd - 1
    const overlap =
      lines[Math.max(line + 1, endLine - Math.min(20, Math.floor(maxLines / 3)))] ?? end
    start = overlap > start && overlap < end ? overlap : end
  }
  validateChunks(fileId, text, chunks)
  return chunks
}
/** 对已分析区间求并集后返回缺口，重叠块不会重复提高覆盖率。 */
export function missingRanges(
  length: number,
  ranges: Array<{ startOffset: number; endOffset: number }>
) {
  const missing: Array<{ startOffset: number; endOffset: number }> = []
  let cursor = 0
  for (const range of [...ranges].sort((a, b) => a.startOffset - b.startOffset)) {
    if (range.startOffset > cursor)
      missing.push({ startOffset: cursor, endOffset: range.startOffset })
    cursor = Math.max(cursor, range.endOffset)
  }
  if (cursor < length) missing.push({ startOffset: cursor, endOffset: length })
  return missing
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
