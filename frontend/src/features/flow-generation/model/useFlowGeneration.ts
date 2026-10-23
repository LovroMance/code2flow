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
import { chineseErrorMessage } from '../../../shared/lib/errorMessage'

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
    } catch {
      failRendering('流程图解析失败，请重新生成。')
    }
  }
  function failRendering(reason: string) {
    status.value = 'error'
    mappings.value = []
    errorMessage.value = reason
  }
  /** 管理多文件流式状态与取消；结果通过契约校验和 Mermaid 解析后才交给页面。 */
  async function generateMultiFlow(threadId: string, snapshotId: string) {
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
          const stages: Record<string, string> = {
            prepare: '准备快照',
            detect: '识别语言',
            basic: '建立检索',
            index: '分析全部文件',
            generate: '生成局部流程',
            complete: '校验流程图',
            resolve: '查找引用候选',
            verify: '核对歧义关系',
            incomplete: '分析未完成'
          }
          progressText.value = `${stages[String(metadata.stage)] ?? '处理中'} ${metadata.completed ?? ''}${metadata.total ? `/${metadata.total}` : ''}`
          if (Array.isArray(metadata.missingRanges))
            incomplete = metadata.missingRanges
              .slice(0, 20)
              .map((value) => {
                if (
                  !value ||
                  typeof value !== 'object' ||
                  !('path' in value) ||
                  !('startOffset' in value) ||
                  !('endOffset' in value)
                )
                  return ''
                return `${String(value.path)} [${String(value.startOffset)}, ${String(value.endOffset)})`
              })
              .filter(Boolean)
              .join('；')
        }
      )
      await restoreMultiOutput(result)
      if (errorMessage.value) throw new Error(errorMessage.value)
      return result
    } catch (error) {
      failRendering(
        `${chineseErrorMessage(error, '多文件生成失败。')}${incomplete ? ` 未完成的原始字符范围：${incomplete}` : ''}`
      )
      throw error
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
    console.log(
      `[code-flow][frontend][state] status=streaming threadId=${input.threadId ?? 'none'}`
    )

    try {
      await streamGenerateFlow(input, handleStreamEvent)
      if (status.value === 'streaming') throw new Error('连接已中断，未收到生成完成事件，请重试。')
    } catch (error) {
      status.value = 'error'
      errorMessage.value = chineseErrorMessage(error, '生成失败，请重试。')
      throw error
    }
  }

  function handleStreamEvent(event: FlowStreamEvent) {
    if (event.type === 'metadata' && isFlowMetadataEvent(event.content)) {
      detectedLanguage.value = event.content.detectedLanguage
      console.log(
        `[code-flow][frontend][state] metadata-updated language=${event.content.detectedLanguage} confidence=${event.content.confidence ?? 'n/a'}`
      )
    }

    if (event.type === 'mermaid' && typeof event.content === 'string') {
      mermaid.value = event.content
      console.log(
        `[code-flow][frontend][state] mermaid-updated lines=${event.content.split('\n').length} length=${event.content.length}`
      )
    }

    if (event.type === 'mappings' && Array.isArray(event.content)) {
      mappings.value = event.content
      console.log(`[code-flow][frontend][state] mappings-updated count=${event.content.length}`)
    }

    if (event.type === 'error' && typeof event.content === 'string') {
      status.value = 'error'
      errorMessage.value = event.content
      console.log(`[code-flow][frontend][state] status=error message=${event.content}`)
      throw new Error(event.content)
    }

    if (event.type === 'done') {
      status.value = 'done'
      console.log('[code-flow][frontend][state] status=done')
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
