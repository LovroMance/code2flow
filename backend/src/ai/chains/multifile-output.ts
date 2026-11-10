import { z } from 'zod'
import { SourceLineRangeSchema } from '../../domain/source/schema'
import { coveredLines, lineOffsets, sourceLineRange } from '../../utils/sourcePositions'
import { ModelOutputValidationError } from '../../domain/multifile/errors'

const internalFields = ['columnStart', 'columnEnd', 'startOffset', 'endOffset']

/** 模型读取的范围使用首尾都包含的行号。 */
export function slimModelInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slimModelInput)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const out = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !internalFields.includes(key) && !['contentHash', 'metering', 'linePositions'].includes(key))
      .map(([key, item]) => [key, slimModelInput(item)])
  )
  const { lineStart, lineEnd, columnEnd } = record
  if (typeof lineStart === 'number' && typeof lineEnd === 'number' && typeof columnEnd === 'number')
    Object.assign(out, coveredLines({ lineStart, lineEnd, columnEnd }))
  return out
}

/** 结构化提交只要求行号，落库前恢复内部范围。 */
export function modelResponseSchema(schema: z.ZodType) {
  const { $schema, ...lineSchema } = z.toJSONSchema(SourceLineRangeSchema)
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    const node = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]))
    const properties = node.properties as Record<string, unknown> | undefined
    if (properties?.fileId && properties.lineStart && properties.lineEnd && properties.columnEnd) {
      for (const field of internalFields) delete properties[field]
      if (Array.isArray(node.required))
        node.required = node.required.filter((key) => !internalFields.includes(key))
    }
    if (properties?.analyzedRanges)
      properties.analyzedRanges = { ...Object(properties.analyzedRanges), items: lineSchema }
    return node
  }
  const converted = visit(z.toJSONSchema(schema)) as Record<string, unknown>
  if (converted.type !== 'object') throw new Error('结构化提交必须是对象。')
  return { ...converted, type: 'object' as const }
}

export function completeModelRanges(input: unknown, contentFor: (fileId: string) => string): unknown {
  const files = new Map<string, { content: string; offsets: number[] }>()
  const resolve = (fileId: string, value: unknown) => {
    const { lineStart, lineEnd } = SourceLineRangeSchema.parse(value)
    let file = files.get(fileId)
    if (!file) {
      const content = contentFor(fileId)
      file = { content, offsets: lineOffsets(content) }
      files.set(fileId, file)
    }
    try {
      return sourceLineRange(fileId, file.content, lineStart, lineEnd, file.offsets)
    } catch {
      throw new ModelOutputValidationError(`源码行范围无效：第 ${lineStart}–${lineEnd} 行，首尾均包含。`)
    }
  }
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    const node = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]))
    const fileId = node.fileId
    if (typeof fileId !== 'string') return node
    if (Array.isArray(node.analyzedRanges))
      node.analyzedRanges = node.analyzedRanges.map((item) => {
        const { startOffset, endOffset } = resolve(fileId, item)
        return { startOffset, endOffset }
      })
    if ('lineStart' in node && 'lineEnd' in node)
      return { ...node, ...resolve(fileId, node) }
    return node
  }
  return visit(input)
}
