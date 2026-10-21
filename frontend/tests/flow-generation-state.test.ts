import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFlowGeneration } from '../src/features/flow-generation/model/useFlowGeneration'
import { streamGenerateFlow } from '../src/shared/api/flow-stream.api'

vi.mock('../src/shared/api/flow-stream.api', () => ({ streamGenerateFlow: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe('生成状态与会话恢复', () => {
  it('断网和缺失 done 事件都进入错误状态，不把半张图当作已完成', async () => {
    const state = useFlowGeneration()
    vi.mocked(streamGenerateFlow).mockRejectedValueOnce(new Error('连接失败'))
    await expect(state.generateFlow({ code: 'code' })).rejects.toThrow('连接失败')
    expect(state.isLoading.value).toBe(false)
    expect(state.status.value).toBe('error')
    vi.mocked(streamGenerateFlow).mockResolvedValueOnce(undefined)
    await expect(state.generateFlow({ code: 'code' })).rejects.toThrow('未收到生成完成事件')
    expect(state.status.value).toBe('error')
  })
  it('切回历史结果恢复完成状态，新空会话清空旧图映射和错误', () => {
    const state = useFlowGeneration()
    const result = {
      mermaid: 'flowchart TD\na[开始]',
      mappings: [],
      detectedLanguage: 'python' as const
    }
    state.restoreOutput(result)
    expect(state.status.value).toBe('done')
    expect(state.mermaid.value).toBe(result.mermaid)
    state.restoreOutput(null, true)
    expect(state.status.value).toBe('error')
    state.restoreOutput(null)
    expect(state.status.value).toBe('idle')
    expect(state.mappings.value).toEqual([])
    expect(state.errorMessage.value).toBe('')
    expect(state.mermaid.value).not.toBe(result.mermaid)
  })
})
