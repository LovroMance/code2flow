import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SourceRangeSchema } from '../src/domain/source/schema'
import { completeModelRanges, modelResponseSchema } from '../src/ai/chains/multifile-output'

describe('模型位置提交与原始源码坐标', () => {
  const content = '中文😀\r\n  if (isVipUser(user)) {\r\n'
  const position = { fileId: 'f', lineStart: 2, lineEnd: 2, columnStart: 7, columnEnd: 22 }
  it('模型契约只要求行列，内部范围和偏移区间契约保持完整', () => {
    const schema = modelResponseSchema(
      z.object({
        range: SourceRangeSchema,
        analyzedRanges: z.array(z.object({ startOffset: z.number(), endOffset: z.number() }))
      })
    )
    const json = JSON.stringify(schema)
    expect(json.match(/startOffset/g)).toHaveLength(2) // 仅analyzedRanges的属性和required。
    expect(SourceRangeSchema.safeParse(position).success).toBe(false)
  })
  it('按原始CRLF和UTF-16换算实际调用范围', () => {
    const result = completeModelRanges({ range: position }, () => content) as {
      range: { startOffset: number; endOffset: number }
    }
    expect(content.slice(result.range.startOffset, result.range.endOffset)).toBe('isVipUser(user)')
    expect(result.range).toMatchObject({ startOffset: 12, endOffset: 27 })
  })
  it('拒绝越界行列及代理对中间的位置，不更改旧的矛盾范围', () => {
    for (const invalid of [
      { ...position, lineEnd: 99 },
      { ...position, columnEnd: 999 },
      { ...position, startOffset: 9, endOffset: 24 },
      { ...position, lineStart: 1, lineEnd: 1, columnStart: 4, columnEnd: 5 }
    ])
      expect(() => completeModelRanges(invalid, () => content)).toThrow()
  })
})
