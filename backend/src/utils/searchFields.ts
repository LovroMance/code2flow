import type { FileSemanticIndex } from '../domain/multifile/schema'
import type { CodeChunk } from '../domain/source/schema'

// 检索字段可拆词及截断，始终与原始位置和正文分离。
export function keywordFields(text: string) {
  return `${text}\n${text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}`
}
export function chunkSemanticFields(index: FileSemanticIndex | undefined, chunk: CodeChunk) {
  if (!index) return ''
  return [
    index.summary,
    ...index.units
      .filter(
        (unit) =>
          unit.range.startOffset < chunk.endOffset && unit.range.endOffset > chunk.startOffset
      )
      .map((unit) => `${unit.name} ${unit.signature} ${unit.summary}`)
  ]
    .join('\n')
    .slice(0, 4000)
}
