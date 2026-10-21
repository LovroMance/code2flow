import { describe, expect, it } from 'vitest'
import { parseSessionDetail, parseSessionList } from '../src/entities/session/model/types'

const summary = {
  id: 'test',
  title: '任务',
  fileName: '',
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
  language: 'javascript',
  hasResult: false,
  hasDraft: false,
  busy: false
}
const detail = {
  ...summary,
  draftCode: 'draft()',
  draftLanguage: 'python',
  sourceCode: '',
  result: null,
  messages: [],
  failed: false
}

describe('会话响应边界', () => {
  it('允许草稿与分析快照使用不同源码和语言', () => {
    expect(parseSessionDetail(detail).draftCode).toBe('draft()')
    expect(parseSessionList({ sessions: [summary] })).toHaveLength(1)
  })
  it('拒绝损坏的目录、消息、节点映射与语言，不把部分状态交给工作区', () => {
    expect(() => parseSessionList({ sessions: [{ ...summary, updatedAt: 'wrong' }] })).toThrow()
    expect(() => parseSessionDetail({ ...detail, draftLanguage: 'wrong' })).toThrow()
    expect(() =>
      parseSessionDetail({ ...detail, messages: [{ role: 'system', content: '不可展示' }] })
    ).toThrow()
    expect(() =>
      parseSessionDetail({
        ...detail,
        result: { detectedLanguage: 'javascript', mermaid: 'flowchart TD', mappings: [{}] }
      })
    ).toThrow()
  })
})
