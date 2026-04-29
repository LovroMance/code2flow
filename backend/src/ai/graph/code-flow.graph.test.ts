import { describe, expect, it } from 'vitest'
import { createInitialCodeFlowGraphState } from './code-flow.state'
import { normalizeFlowNode } from './nodes/normalize-flow.node'
import { retryNode } from './nodes/retry.node'
import { validateNode } from './nodes/validate.node'
import { routeAfterValidation } from './routers/code-flow.router'

describe('code flow graph helpers', () => {
  it('creates an initial state with sensible defaults', () => {
    const state = createInitialCodeFlowGraphState({
      code: 'const answer = 42',
      threadId: 'thread-1'
    })

    expect(state.mode).toBe('generate')
    expect(state.threadId).toBe('thread-1')
    expect(state.retryCount).toBe(0)
    expect(state.maxRetries).toBe(1)
  })

  it('validates a complete result successfully', async () => {
    const state = await validateNode({
      ...createInitialCodeFlowGraphState({
        code: 'const answer = 42'
      }),
      detectedLanguage: 'javascript',
      result: {
        detectedLanguage: 'javascript',
        mermaid: 'flowchart TD\nn_start_1[开始] --> n_action_1[赋值]',
        mappings: [
          {
            nodeId: 'n_start_1',
            kind: 'start',
            label: '开始',
            description: '流程开始',
            lineStart: 1,
            lineEnd: 1
          },
          {
            nodeId: 'n_action_1',
            kind: 'action',
            label: '赋值',
            description: '定义常量',
            lineStart: 1,
            lineEnd: 1
          }
        ]
      }
    })

    expect(state.error).toBeUndefined()
    expect(routeAfterValidation(state)).toBe('normalize')
  })

  it('captures validation errors and routes to retry first', async () => {
    const state = await validateNode({
      ...createInitialCodeFlowGraphState({
        code: 'const answer = 42'
      }),
      detectedLanguage: 'javascript',
      result: {
        detectedLanguage: 'typescript',
        mermaid: 'flowchart TD\nn_start_1[开始] --> n_action_1[赋值]',
        mappings: [
          {
            nodeId: 'n_start_1',
            kind: 'start',
            label: '开始',
            description: '流程开始',
            lineStart: 1,
            lineEnd: 1
          },
          {
            nodeId: 'n_action_1',
            kind: 'action',
            label: '赋值',
            description: '定义常量',
            lineStart: 1,
            lineEnd: 1
          }
        ]
      }
    })

    expect(state.error).toContain('Detected language mismatch')
    expect(routeAfterValidation(state)).toBe('retry')
  })

  it('normalizes line mappings against executable lines', async () => {
    const state = await normalizeFlowNode({
      ...createInitialCodeFlowGraphState({
        code: '// comment only\n\nconst answer = 42'
      }),
      result: {
        detectedLanguage: 'javascript',
        mermaid: 'flowchart TD\nn_action_1[赋值] --> n_end_3[结束]',
        mappings: [
          {
            nodeId: 'n_action_1',
            kind: 'action',
            label: '赋值',
            description: '定义常量',
            lineStart: 1,
            lineEnd: 1
          },
          {
            nodeId: 'n_end_3',
            kind: 'end',
            label: '结束',
            description: '流程结束',
            lineStart: 3,
            lineEnd: 3
          }
        ]
      }
    })

    expect(state.result?.mappings[0]?.lineStart).toBe(3)
    expect(state.result?.mappings[0]?.lineEnd).toBe(3)
  })

  it('increments retry count and clears transient state', async () => {
    const state = await retryNode({
      ...createInitialCodeFlowGraphState({
        code: 'const answer = 42'
      }),
      retryCount: 0,
      error: 'Generated Mermaid is invalid',
      validationErrors: ['Generated Mermaid is invalid'],
      result: {
        detectedLanguage: 'javascript',
        mermaid: 'flowchart TD\nn_action_1[赋值] --> n_end_1[结束]',
        mappings: [
          {
            nodeId: 'n_action_1',
            kind: 'action',
            label: '赋值',
            description: '定义常量',
            lineStart: 1,
            lineEnd: 1
          },
          {
            nodeId: 'n_end_1',
            kind: 'end',
            label: '结束',
            description: '流程结束',
            lineStart: 1,
            lineEnd: 1
          }
        ]
      }
    })

    expect(state.retryCount).toBe(1)
    expect(state.error).toBeUndefined()
    expect(state.result).toBeUndefined()
  })
})
