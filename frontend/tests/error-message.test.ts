import { describe, expect, it } from 'vitest'
import { AxiosError } from 'axios'
import { chineseErrorMessage } from '../src/shared/lib/errorMessage'

describe('界面错误中文化', () => {
  it('网络、超时、取消和解析错误不直接显示依赖英文', () => {
    expect(chineseErrorMessage(new TypeError('Failed to fetch'))).toContain('网络连接失败')
    expect(chineseErrorMessage(new AxiosError('timeout', 'ECONNABORTED'))).toContain('请求超时')
    expect(chineseErrorMessage(new Error('aborted'))).toContain('已取消')
    expect(chineseErrorMessage(new SyntaxError('Unexpected token'))).toContain('数据格式异常')
  })
  it('保留后端具体中文提示，纯英文错误使用中文兜底', () => {
    const error = Object.assign(new AxiosError('Request failed'), {
      response: { status: 400, data: { error: '源码范围校验失败。' } }
    })
    expect(chineseErrorMessage(error)).toBe('源码范围校验失败。')
    expect(chineseErrorMessage(new Error('Internal server error'), '生成失败，请重试。')).toBe(
      '生成失败，请重试。'
    )
    const limit = Object.assign(new AxiosError('Request failed'), {
      response: { status: 429, data: {} }
    })
    expect(chineseErrorMessage(limit)).toContain('请求过于频繁')
  })
})
