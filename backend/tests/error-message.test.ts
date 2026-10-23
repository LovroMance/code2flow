import { describe, expect, it } from 'vitest'
import { chineseErrorMessage, schemaIssueMessage } from '../src/utils/errorMessage'
import { safeErrorDetails } from '../src/ai/observability/safe-error'
import request from 'supertest'
import { createApp } from '../src/app/createApp'

describe('中文错误说明', () => {
  it('请求格式错误和未知接口返回中文JSON', async () => {
    const app = createApp()
    const malformed = await request(app)
      .post('/api/generate-flow')
      .set('Content-Type', 'application/json')
      .send('{')
    expect(malformed.status).toBe(400)
    expect(malformed.body.error).toContain('JSON 格式')
    const missing = await request(app).get('/api/not-found')
    expect(missing.status).toBe(404)
    expect(missing.body.error).toContain('接口不存在')
  })
  it('展开包装异常并翻译依赖类型，不返回供应商原文', () => {
    class StructuredOutputParsingError extends Error {}
    const cause = new StructuredOutputParsingError('private source and secret')
    const wrapper = Object.assign(new Error('middleware failed'), { cause })
    expect(chineseErrorMessage(wrapper)).toContain('结构化结果不符合格式要求')
    expect(JSON.stringify(safeErrorDetails(wrapper))).not.toContain('private source')
  })
  it('中文业务提示保持具体，诊断脱敏模式不输出异常原文', () => {
    const error = new Error('源码内容含有私密文本')
    expect(chineseErrorMessage(error)).toBe(error.message)
    expect(JSON.stringify(safeErrorDetails(error))).not.toContain('私密文本')
    expect(schemaIssueMessage('invalid_type', 'string')).toContain('应为字符串')
  })
  it('服务错误、超时和取消均有中文说明', () => {
    expect(chineseErrorMessage({ status: 429 })).toContain('请求过于频繁')
    expect(chineseErrorMessage(new Error('fetch failed'))).toContain('网络连接失败')
    expect(chineseErrorMessage(new Error('request timed out'))).toContain('请求超时')
    expect(chineseErrorMessage(new Error('aborted'))).toContain('已取消')
  })
})
