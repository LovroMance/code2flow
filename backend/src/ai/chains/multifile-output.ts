import { z } from 'zod'
import { SourceRangeSchema } from '../../domain/source/schema'
import { lineOffsets, sourceRange, validateSourceRange } from '../../utils/sourcePositions'
import { ModelOutputValidationError } from '../../domain/multifile/errors'

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
    throw new ModelOutputValidationError('源码范围行号越界。')
  if (!('startOffset' in node) && !('endOffset' in node)) {
    node.startOffset = offsets[position.lineStart - 1]! + position.columnStart - 1
    node.endOffset = offsets[position.lineEnd - 1]! + position.columnEnd - 1
  }
  const range = SourceRangeSchema.parse(node)
  try {
    validateSourceRange(range, position.fileId, content, offsets)
  } catch (error) {
    if (error instanceof Error && error.constructor === Error) {
      const canonical = sourceRange(
        position.fileId,
        content,
        range.startOffset,
        range.endOffset,
        offsets
      )
      // 唯一容忍的表示差异：模型按"行文本含行尾换行符"的约定计数，其行列换算出的
      // 字符区间与提交偏移完全一致——属同一范围的两种写法，规范化为显示约定；其余差异仍拒绝。
      const submittedStart = (offsets[position.lineStart - 1] ?? 0) + position.columnStart - 1
      const submittedEnd = (offsets[position.lineEnd - 1] ?? 0) + position.columnEnd - 1
      if (submittedStart === range.startOffset && submittedEnd === range.endOffset) {
        node.lineStart = canonical.lineStart
        node.columnStart = canonical.columnStart
        node.lineEnd = canonical.lineEnd
        node.columnEnd = canonical.columnEnd
        return node
      }
      // 反馈携带提交值、该行原文与正确行列，模型按前缀显示自行纠正，程序不改写。
      const lineStart = offsets[position.lineStart - 1]!,
        lineEndOffset = offsets[position.lineStart] ?? content.length
      const lineText = content.slice(lineStart, lineEndOffset).replace(/[\r\n]+$/, '')
      throw new ModelOutputValidationError(
        `范围坐标与原文不一致：您提交了行${position.lineStart}:${position.columnStart}-${position.lineEnd}:${position.columnEnd}${'startOffset' in node ? `与偏移[${range.startOffset},${range.endOffset})` : ''}。行${position.lineStart}的原文为"${lineText}"。行列指"行号| "前缀之后文本内的1起始坐标，columnEnd排他；按此显示该范围应对应行${canonical.lineStart}:${canonical.columnStart}-${canonical.lineEnd}:${canonical.columnEnd}。请勿提交startOffset/endOffset，只提交行列。`
      )
    }
    throw error
  }
  return node
}
