import { describe, expect, it, vi } from 'vitest'
import { numberSourceLines } from '../src/utils/numberSourceLines'
import { generateCodeFlowDraft } from '../src/ai/chains/code-flow.chain'
import { createModelServer, result } from './fixtures/model.fixture'

describe('模型输入源码编号', () => {
  it.each([
    ['const a = 1', '1 | const a = 1'],
    ['const a = 1\r\n\r\n  use(a)', '1 | const a = 1\n2 | \n3 |   use(a)'],
    ['\n// 注释\nrun()\n', '1 | \n2 | // 注释\n3 | run()\n4 | '],
    ['const text = "a\\nb"\nuse(text)', '1 | const text = "a\\nb"\n2 | use(text)']
  ])('保留原始物理行与内容：%j', (code, expected) => {
    expect(numberSourceLines(code)).toBe(expected)
  })

  it('实际模型请求使用编号副本，原始源码和返回映射不增加偏移', async () => {
    const server = await createModelServer([
      { args: { mermaid: result.mermaid, mappings: result.mappings } }
    ])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = vi.spyOn(console, 'dir').mockImplementation(() => {})
    const code = 'const a = 1\r\n\r\n  use(a)'
    const input = { code, detectedLanguage: 'javascript' as const }
    try {
      const generated = await generateCodeFlowDraft(input, { model: server.model })
      expect(server.requests[0].messages.find((message) => message.role === 'user')?.content).toBe(
        '1 | const a = 1\n2 | \n3 |   use(a)'
      )
      expect(input.code).toBe(code)
      expect(generated).toEqual(result)
    } finally {
      await server.close()
      log.mockRestore()
      dir.mockRestore()
    }
  })
})
