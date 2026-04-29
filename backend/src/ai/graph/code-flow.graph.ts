import type { FlowGenerationResult } from '../../domain/flow/types'
import { createInitialCodeFlowGraphState } from './code-flow.state'
import { analyzeFlowNode } from './nodes/analyze-flow.node'
import { detectLanguageNode } from './nodes/detect-language.node'
import { normalizeFlowNode } from './nodes/normalize-flow.node'
import { retryNode } from './nodes/retry.node'
import { routeAfterValidation } from './routers/code-flow.router'
import { validateNode } from './nodes/validate.node'

// 非流式入口：按 detect -> analyze -> validate -> normalize/retry 的顺序驱动 graph。
export async function generateCodeFlowWithGraph(input: {
  code: string
  threadId?: string
}): Promise<FlowGenerationResult> {
  let state = createInitialCodeFlowGraphState({
    code: input.code,
    threadId: input.threadId
  })

  state = await detectLanguageNode(state)

  while (true) {
    state = await analyzeFlowNode(state)
    state = await validateNode(state)

    // 校验后统一由 router 决定是进入归一化、重试还是直接报错结束。
    const route = routeAfterValidation(state)

    if (route === 'normalize') {
      state = await normalizeFlowNode(state)

      if (!state.result) {
        throw new Error('Graph normalization finished without a result')
      }

      return state.result
    }

    if (route === 'error') {
      throw new Error(state.error ?? 'Graph generation failed')
    }

    state = await retryNode(state)
  }
}

// 流式入口与非流式共享同一条 graph 主链，只是在分析阶段额外透出 partial Mermaid。
export async function streamCodeFlowWithGraph(
  input: {
    code: string
    threadId?: string
  },
  callbacks: {
    onPartialMermaid: (mermaid: string) => void
    onDetectedLanguage?: (payload: {
      detectedLanguage: import('../../domain/flow/types').SupportedLanguage
      confidence?: number
    }) => void
  }
): Promise<FlowGenerationResult> {
  let state = createInitialCodeFlowGraphState({
    code: input.code,
    threadId: input.threadId
  })

  state = await detectLanguageNode(state, {
    onDetectedLanguage: callbacks.onDetectedLanguage
  })

  while (true) {
    state = await analyzeFlowNode(state, {
      onPartialMermaid: callbacks.onPartialMermaid
    })
    state = await validateNode(state)

    // 流式模式下也沿用同一套路由逻辑，避免两套流程分叉。
    const route = routeAfterValidation(state)

    if (route === 'normalize') {
      state = await normalizeFlowNode(state)

      if (!state.result) {
        throw new Error('Graph normalization finished without a result')
      }

      return state.result
    }

    if (route === 'error') {
      throw new Error(state.error ?? 'Graph generation failed')
    }

    state = await retryNode(state)
  }
}
