import { computed, ref } from 'vue'
import type {
  FlowMetadataEvent,
  FlowGenerationResult,
  FlowStreamEvent,
  NodeMapping,
  SupportedLanguage
} from '../../../entities/flow/model/types'
import { streamGenerateFlow } from '../../../shared/api/flow-stream.api'
import { streamMultiFlow } from '../../../shared/api/multifile.api'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'
import type { MultiFileResult } from '../../../entities/flow/model/multifile'
import { getErrorMessage } from '../../../shared/lib/errorMessage'

const EMPTY_MERMAID = 'flowchart TD\nA[等待输入代码] --> B[点击生成流程图]\nB --> C[展示结果]'
const LOADING_MERMAID = 'flowchart TD\nA[请求已发送] --> B[等待 Agent 返回结果]'
const DEFAULT_LANGUAGE: SupportedLanguage = 'javascript'

export function useFlowGeneration() {
  const status = ref<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const mermaid = ref(EMPTY_MERMAID)
  const mappings = ref<NodeMapping[]>([])
  const errorMessage = ref('')
  const detectedLanguage = ref<SupportedLanguage>(DEFAULT_LANGUAGE)
  const multiResult = ref<MultiFileResult | null>(null)
  const progressText = ref('')
  let abortController: AbortController | undefined

  const isLoading = computed(() => status.value === 'streaming')

  function resetOutput(empty = false) {
    status.value = 'idle'
    mermaid.value = empty ? '' : EMPTY_MERMAID
    mappings.value = []
    errorMessage.value = ''
    multiResult.value = null
    progressText.value = ''
  }

  function setDetectedLanguage(language: SupportedLanguage) {
    detectedLanguage.value = language
  }

  function restoreOutput(result: FlowGenerationResult | null, failed = false) {
    resetOutput()
    if (result) {
      mermaid.value = result.mermaid
      mappings.value = result.mappings
      status.value = 'done'
    } else if (failed) {
      status.value = 'error'
      errorMessage.value = '上次分析失败，请重新生成流程图。'
    }
  }

  async function restoreMultiOutput(result: MultiFileResult | null, failed = false) {
    restoreOutput(null, failed)
    mermaid.value = ''
    if (!result) return
    try {
      if (result.hasExecutableFlow) await ensureMermaid().parse(result.mermaid)
      mermaid.value = result.mermaid
      mappings.value = result.mappings
      detectedLanguage.value = result.detectedLanguage
      multiResult.value = result
      status.value = 'done'
    } catch (error) {
      failRendering(getErrorMessage(error, '流程图解析失败。'))
    }
  }
  function failRendering(reason: string) {
    status.value = 'error'
    mappings.value = []
    errorMessage.value = reason
  }
  /** 管理多文件流式状态与取消；结果通过契约校验和 Mermaid 解析后才交给页面。 */
  async function generateMultiFlow(threadId: string, snapshotId: string, onChunksReady: () => void) {
    resetOutput()
    status.value = 'streaming'
    mermaid.value = ''
    abortController = new AbortController()
    let incomplete = ''
    try {
      const result = await streamMultiFlow(
        threadId,
        snapshotId,
        abortController.signal,
        (metadata) => {
          if (metadata.stage === 'chunks-ready') onChunksReady()
          const stages: Record<string, string> = {
            prepare: '准备快照',
            detect: '识别语言',
            basic: '建立检索',
            'chunks-ready': '源码切块完成',
            index: '分析全部文件',
            generate: '生成局部流程',
            complete: '校验流程图',
            resolve: '查找引用候选',
            incomplete: '分析未完成'
          }
          progressText.value = `${stages[String(metadata.stage)] ?? '处理中'} ${metadata.completed ?? ''}${metadata.total ? `/${metadata.total}` : ''}`
          if (Array.isArray(metadata.missingRanges))
            incomplete = metadata.missingRanges
              .map((value) => {
                if (
                  !value ||
                  typeof value !== 'object' ||
                  !('path' in value) ||
                  !('lineStart' in value) ||
                  !('lineEnd' in value)
                )
                  return ''
                return `${String(value.path)} 第 ${String(value.lineStart)}–${String(value.lineEnd)} 行`
              })
              .filter(Boolean)
              .join('\n')
        }
      )
      await restoreMultiOutput(result)
    } catch (error) {
      failRendering(
        `${getErrorMessage(error, '多文件生成失败。')}${incomplete ? `\n未完成的源码行范围：\n${incomplete}` : ''}`
      )
    } finally {
      abortController = undefined
    }
  }

  // 这里统一收口生成请求输入，方便后续继续补 question、mode 等会话字段。
  async function generateFlow(input: { code: string; threadId?: string }) {
    status.value = 'streaming'
    mermaid.value = LOADING_MERMAID
    mappings.value = []
    errorMessage.value = ''

    try {
      await streamGenerateFlow(input, handleStreamEvent)
      if (status.value === 'streaming') throw new Error('连接已中断，未收到生成完成事件，请重试。')
    } catch (error) {
      status.value = 'error'
      errorMessage.value = getErrorMessage(error, '生成失败。')
    }
  }

  function handleStreamEvent(event: FlowStreamEvent) {
    if (event.type === 'metadata' && isFlowMetadataEvent(event.content)) {
      detectedLanguage.value = event.content.detectedLanguage
    }

    if (event.type === 'mermaid' && typeof event.content === 'string') {
      mermaid.value = event.content
    }

    if (event.type === 'mappings' && Array.isArray(event.content)) {
      mappings.value = event.content
    }

    if (event.type === 'error' && typeof event.content === 'string') {
      throw new Error(event.content)
    }

    if (event.type === 'done') {
      status.value = 'done'
    }
  }

  return {
    multiResult,
    progressText,
    generateMultiFlow,
    restoreMultiOutput,
    failRendering,
    cancelGeneration: () => abortController?.abort(),
    errorMessage,
    detectedLanguage,
    generateFlow,
    isLoading,
    mappings,
    mermaid,
    resetOutput,
    restoreOutput,
    setDetectedLanguage,
    status
  }
}

function isFlowMetadataEvent(payload: FlowStreamEvent['content']): payload is FlowMetadataEvent {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'detectedLanguage' in payload &&
    typeof payload.detectedLanguage === 'string'
  )
}
