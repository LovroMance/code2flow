import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { safeErrorDetails } from '../src/ai/observability/safe-error'

describe('多文件异常诊断脱敏', () => {
  it('LangChain字符串校验原因保留固定分类，不输出原文', () => {
    const details = safeErrorDetails({
      name: 'StructuredOutputParsingError',
      errors: ['required property: secret']
    })
    expect(details.errors).toEqual([
      expect.objectContaining({
        type: 'ValidationMessage',
        categories: ['missing_field'],
        message: expect.stringContaining('校验')
      })
    ])
    expect(JSON.stringify(details)).not.toContain('secret')
  })
  it('展开包装异常中的 schema 原因，并保留字段位置', () => {
    const result = z
      .object({ units: z.array(z.object({ complete: z.boolean() })) })
      .safeParse({ units: [{ complete: 'private-source-and-api-key' }] })
    if (result.success) throw new Error('应校验失败')
    const outer = new Error('private-source-and-api-key')
    Object.assign(outer, { cause: result.error, request: 'private-source-and-api-key' })
    const details = safeErrorDetails(outer)
    expect(details.cause).toMatchObject({
      issues: [{ path: ['units', 0, 'complete'], code: 'invalid_type' }]
    })
    expect(JSON.stringify(details)).not.toContain('private-source-and-api-key')
  })

  it('隐藏任意属性名和异常原文，且循环原因不会导致日志失败', () => {
    const error = {
      name: 'MiddlewareError',
      message: 'tool failed: secret',
      issues: [{ path: ['secret'], code: 'invalid_type', message: 'secret' }],
      cause: {}
    }
    error.cause = error
    const details = safeErrorDetails(error)
    expect(details).toMatchObject({ categories: ['tool_execution'], issues: [{ path: ['*'] }] })
    expect(JSON.stringify(details)).not.toContain('secret')
    expect(details.cause).toMatchObject({
      type: 'UnknownOrCircularError',
      message: expect.stringContaining('原因链')
    })
  })
})
