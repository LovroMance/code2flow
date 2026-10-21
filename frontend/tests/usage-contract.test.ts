import { describe, expect, it } from 'vitest'
import { parseUsageList } from '../src/entities/usage/model/types'

describe('用量响应边界', () => {
  it('接受没有供应商用量的失败记录', () => {
    const data = {
      tracingEnabled: true,
      scanLimited: false,
      records: [
        {
          runId: 'failed',
          startedAt: '2026-10-21T00:00:00.000Z',
          requestedModel: 'deepseek-chat',
          responseModels: [],
          outcome: 'error',
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          retryCount: 1,
          completeness: 'missing',
          source: 'online'
        }
      ]
    }
    expect(parseUsageList(data).records[0].totalTokens).toBeNull()
  })
  it('拒绝畸形接口响应', () => {
    expect(() => parseUsageList({ records: [] })).toThrow()
    expect(() =>
      parseUsageList({ tracingEnabled: true, scanLimited: false, records: [{ totalTokens: -1 }] })
    ).toThrow()
  })
})
