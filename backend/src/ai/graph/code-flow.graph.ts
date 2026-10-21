import { END, REMOVE_ALL_MESSAGES, START, StateGraph } from '@langchain/langgraph'
import { RemoveMessage } from '@langchain/core/messages'
import { randomUUID } from 'node:crypto'
import { CodeFlowState } from './code-flow.state'
import type { CodeFlowGraphInput, CodeFlowGraphRunOptions } from './code-flow.types'
import { generateCodeFlowDraft } from '../chains/code-flow.chain'
import { explainCodeFlowFollowUp } from '../chains/explain-followup.chain'
import { runDetectLanguage } from '../tools/detect-language.tool'
import { parseFlowGenerationResult } from '../../utils/flowResultValidator'
import { validateMermaid } from '../../utils/mermaidValidator'
import { normalizeMermaidSource } from '../../utils/mermaidNormalizer'
import { normalizeFlowResultAgainstCode } from '../../utils/mappingNormalizer'
import { resolveRunConfig } from '../observability/run-config'
import { loadLegacyCheckpoint } from './checkpointer'
import { createNodeCallbacks } from '../observability/run-callbacks'

// 只保留三个业务节点；框架负责状态合并、条件跳转和 checkpoint 生命周期。
export function createCodeFlowGraph(options: CodeFlowGraphRunOptions = {}) {
  return new StateGraph(CodeFlowState)
    .addNode('analyze', async (state) => {
      // 每次新生成只检测一次；生成重试复用当前状态，避免重复请求 Jev。
      const detected = state.languageDetection ?? (await runDetectLanguage(state.code))
      if (state.languageDetection) {
        console.info('[code-flow][jev] detection-reused', {
          attempt: state.attempts + 1,
          language: detected.language,
          confidence: detected.confidence,
          status: detected.status
        })
      }
      if (state.attempts === 0)
        options.callbacks?.onDetectedLanguage?.({
          detectedLanguage: detected.language,
          confidence: detected.confidence
        })
      try {
        const result = await generateCodeFlowDraft(
          { code: state.code, detectedLanguage: detected.language, feedback: state.error },
          options
        )
        return {
          result,
          detectedLanguage: detected.language,
          languageDetection: detected,
          error: null,
          attempts: state.attempts + 1
        }
      } catch (error) {
        return {
          result: null,
          detectedLanguage: detected.language,
          languageDetection: detected,
          error: error instanceof Error ? error.message : String(error),
          attempts: state.attempts + 1
        }
      }
    })
    .addNode('validate', async (state) => {
      try {
        if (state.error) throw new Error(state.error)
        const result = parseFlowGenerationResult(state.result)
        result.mermaid = normalizeMermaidSource(result.mermaid)
        if (!validateMermaid(result.mermaid)) throw new Error('Generated Mermaid is invalid')
        return {
          result: normalizeFlowResultAgainstCode(state.code, result),
          error: null
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.trace?.setValidationErrors([message])
        return { result: null, error: message }
      }
    })
    .addNode('explain', (state) => explainCodeFlowFollowUp(state, options))
    .addConditionalEdges(START, (state) => (state.mode === 'followup' ? 'explain' : 'analyze'), [
      'explain',
      'analyze'
    ])
    .addEdge('analyze', 'validate')
    .addConditionalEdges(
      'validate',
      (state) => {
        options.trace?.setRetryCount(state.attempts - 1)
        return state.error && state.attempts <= state.maxRetries ? 'analyze' : END
      },
      ['analyze', END]
    )
    .addEdge('explain', END)
    .compile({ checkpointer: options.checkpointer })
}

// 新生成清空旧结果和聊天；追问只提交问题，由 LangGraph 自动恢复同线程状态。
export async function runCodeFlowGraph(
  input: CodeFlowGraphInput,
  options: CodeFlowGraphRunOptions = {}
) {
  const graph = createCodeFlowGraph(options)
  const config = {
    configurable: { thread_id: input.threadId ?? randomUUID() },
    recursionLimit: 100,
    callbacks: createNodeCallbacks(options.trace)
  }
  if (input.mode === 'followup') {
    let previous = await graph.getState(config)
    if (!previous.config.configurable?.checkpoint_id && input.threadId) {
      const legacy = await loadLegacyCheckpoint(input.threadId, options.checkpointer)
      if (legacy) {
        await graph.updateState(
          config,
          { ...legacy, detectedLanguage: legacy.result.detectedLanguage },
          'validate'
        )
        previous = await graph.getState(config)
      }
    }
    if (!input.question?.trim()) throw new Error('Missing follow-up question')
    if (!previous.values.result)
      throw new Error('Missing previous flow result for follow-up explanation')
    if (input.code.trim() && input.code !== previous.values.code)
      throw new Error('代码已变更，请重新生成流程图后再追问。')
    return graph.invoke({ mode: 'followup', question: input.question, error: null }, config)
  }
  const state = await graph.invoke(
    {
      code: input.code,
      mode: 'generate',
      question: '',
      result: null,
      languageDetection: null,
      detectedLanguage: 'unknown',
      explanation: '',
      error: null,
      attempts: 0,
      maxRetries: resolveRunConfig({ maxRetries: input.maxRetries }).maxRetries,
      messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES })]
    },
    config
  )
  if (state.error || !state.result)
    throw new Error(state.error ?? 'Graph finished without a result')
  return state
}
