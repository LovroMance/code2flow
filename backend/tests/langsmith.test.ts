import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { END, START, StateGraph, Annotation } from '@langchain/langgraph'
import {
  analysisTraceConfig,
  configureLangSmith,
  traceStep
} from '../src/ai/observability/langsmith'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('LangSmith 配置', () => {
  it('默认关闭且不要求账号配置', () => {
    vi.stubEnv('LANGSMITH_TRACING', 'false')
    vi.stubEnv('LANGSMITH_API_KEY', '')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureLangSmith()
    expect(process.env.LANGSMITH_TRACING).toBe('false')
    expect(warning).not.toHaveBeenCalled()
  })

  it('启用但未填密钥时停止上传，不中断业务', () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_API_KEY', ' ')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureLangSmith()
    expect(process.env.LANGSMITH_TRACING).toBe('false')
  })

  it('允许可选配置留空，且启动日志不包含密钥', () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_API_KEY', 'test-secret-never-upload')
    vi.stubEnv('LANGSMITH_ENDPOINT', '')
    vi.stubEnv('LANGSMITH_PROJECT', '')
    vi.stubEnv('LANGSMITH_WORKSPACE_ID', '')
    vi.stubEnv('LANGCHAIN_CALLBACKS_BACKGROUND', 'true')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    configureLangSmith()
    expect(process.env.LANGSMITH_PROJECT).toBe('code2flow-dev')
    expect(process.env.LANGSMITH_ENDPOINT).toBe('https://api.smith.langchain.com')
    expect(process.env.LANGSMITH_WORKSPACE_ID).toBeUndefined()
    expect(JSON.stringify(info.mock.calls)).not.toContain('test-secret-never-upload')
  })

  it('拒绝无效或含凭据的端点且不输出该地址', () => {
    vi.stubEnv('LANGSMITH_TRACING', 'true')
    vi.stubEnv('LANGSMITH_API_KEY', 'test-secret')
    vi.stubEnv('LANGSMITH_ENDPOINT', 'https://user:secret@example.com')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureLangSmith()
    expect(process.env.LANGSMITH_TRACING).toBe('false')
    expect(JSON.stringify(warning.mock.calls)).not.toContain('user:secret')
  })
})

describe('原生追踪上下文', () => {
  it('Graph、并行步骤和现有回调保持父子关系及会话元数据', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'false')
    const starts: Array<{
      id: string
      parent?: string
      name?: string
      metadata?: Record<string, unknown>
    }> = []
    const outputs = new Map<string, unknown>()
    const handler = BaseCallbackHandler.fromMethods({
      handleChainStart(_chain, _input, id, parent, _tags, metadata, _runType, name) {
        starts.push({ id, parent, name, metadata })
      },
      handleChainEnd(output, id) {
        outputs.set(id, output)
      }
    })
    const localCallback = vi.fn()
    const state = Annotation.Root({ value: Annotation<string> })
    const graph = new StateGraph(state)
      .addNode('analyze', async () => {
        const results = await Promise.all(
          ['a', 'b'].map((taskId) =>
            traceStep(`task-${taskId}`, { taskId }, async () => ({ result: taskId }), {
              metadata: { task_id: taskId },
              callbacks: [BaseCallbackHandler.fromMethods({ handleChainEnd: localCallback })]
            })
          )
        )
        return { value: results.map((result) => result.result).join('') }
      })
      .addEdge(START, 'analyze')
      .addEdge('analyze', END)
      .compile()
    const result = await traceStep(
      'request',
      { snapshotId: 'snapshot' },
      () => graph.invoke({ value: '' }, { runName: 'graph' }),
      {
        ...analysisTraceConfig('multifile', 'session', { snapshot_id: 'snapshot' }),
        callbacks: [handler]
      }
    )
    expect(result.value).toBe('ab')
    const root = starts.find((run) => run.name === 'request')!
    const graphRun = starts.find((run) => run.name === 'graph')!
    const node = starts.find((run) => run.name === 'analyze')!
    expect(graphRun.parent).toBe(root.id)
    expect(node.parent).toBe(graphRun.id)
    for (const taskId of ['a', 'b']) {
      const task = starts.find((run) => run.name === `task-${taskId}`)!
      expect(task.parent).toBe(node.id)
      expect(task.metadata).toMatchObject({
        session_id: 'session',
        snapshot_id: 'snapshot',
        task_id: taskId
      })
      expect(outputs.get(task.id)).toMatchObject({ result: taskId })
    }
    expect(localCallback).toHaveBeenCalledTimes(2)
  })

  it('业务异常保留原对象，并使请求级追踪进入错误状态', async () => {
    vi.stubEnv('LANGSMITH_TRACING', 'false')
    const failure = new Error('分析已取消')
    const errors = vi.fn()
    await expect(
      traceStep(
        'request',
        {},
        async () => {
          throw failure
        },
        {
          callbacks: [BaseCallbackHandler.fromMethods({ handleChainError: errors })]
        }
      )
    ).rejects.toBe(failure)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0][0]).toBe(failure)
  })
})
