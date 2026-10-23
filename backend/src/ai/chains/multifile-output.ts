import { z } from 'zod'
import { SourceRangeSchema } from '../../domain/source/schema'
import { lineOffsets, validateSourceRange } from '../../utils/sourcePositions'

/** 模型只提交行列，避免同时预测行列和字符偏移；内部及对外契约仍保留完整范围。 */
export function modelResponseSchema(schema: z.ZodType) {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    const node = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]))
    const properties = node.properties as Record<string, unknown> | undefined
    if (
      properties?.fileId &&
      properties.lineStart &&
      properties.columnStart &&
      properties.lineEnd &&
      properties.columnEnd
    ) {
      delete properties.startOffset
      delete properties.endOffset
      if (Array.isArray(node.required))
        node.required = node.required.filter((key) => key !== 'startOffset' && key !== 'endOffset')
    }
    return node
  }
  const converted = visit(z.toJSONSchema(schema)) as Record<string, unknown>
  if (converted.type !== 'object') throw new Error('结构化提交必须是对象。')
  return { ...converted, type: 'object' as const }
}

/** 按原始正文换算位置，不修正越界行列；旧的完整范围仍须两套坐标完全一致。 */
export function completeModelRanges(
  input: unknown,
  contentFor: (fileId: string) => string
): unknown {
  if (Array.isArray(input)) return input.map((item) => completeModelRanges(item, contentFor))
  if (!input || typeof input !== 'object') return input
  const node = Object.fromEntries(
    Object.entries(input).map(([key, item]) => [key, completeModelRanges(item, contentFor)])
  )
  if (!['fileId', 'lineStart', 'lineEnd', 'columnStart', 'columnEnd'].every((key) => key in node))
    return node
  const position = SourceRangeSchema.omit({ startOffset: true, endOffset: true }).parse(node)
  const content = contentFor(position.fileId)
  const offsets = lineOffsets(content)
  if (offsets[position.lineStart - 1] === undefined || offsets[position.lineEnd - 1] === undefined)
    throw new Error('源码范围行号越界。')
  if (!('startOffset' in node) && !('endOffset' in node)) {
    node.startOffset = offsets[position.lineStart - 1]! + position.columnStart - 1
    node.endOffset = offsets[position.lineEnd - 1]! + position.columnEnd - 1
  }
  const range = SourceRangeSchema.parse(node)
  validateSourceRange(range, position.fileId, content, offsets)
  return node
}
