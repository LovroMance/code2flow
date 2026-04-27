import { computed, ref } from 'vue'
import type {
  FlowMetadataEvent,
  FlowStreamEvent,
  NodeMapping,
  SupportedLanguage
} from '../../../entities/flow/model/types'
import { streamGenerateFlow } from '../../../shared/api/flow-stream.api'

const EMPTY_MERMAID = 'flowchart TD\nA[等待输入代码] --> B[点击生成流程图]\nB --> C[展示结果]'
const LOADING_MERMAID = 'flowchart TD\nA[请求已发送] --> B[等待 Agent 返回结果]'
const DEFAULT_LANGUAGE: SupportedLanguage = 'javascript'

export function useFlowGeneration() {
  const status = ref<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const mermaid = ref(EMPTY_MERMAID)
  const mappings = ref<NodeMapping[]>([])
  const errorMessage = ref('')
  const detectedLanguage = ref<SupportedLanguage>(DEFAULT_LANGUAGE)

  const isLoading = computed(() => status.value === 'streaming')

  function resetOutput() {
    status.value = 'idle'
    mermaid.value = EMPTY_MERMAID
    mappings.value = []
    errorMessage.value = ''
  }

  function setDetectedLanguage(language: SupportedLanguage) {
    detectedLanguage.value = language
  }

  async function generateFlow(code: string) {
    status.value = 'streaming'
    mermaid.value = LOADING_MERMAID
    mappings.value = []
    errorMessage.value = ''
    console.log('[code-flow][frontend][state] status=streaming')

    await streamGenerateFlow(code, handleStreamEvent)

    if (status.value === 'streaming') {
      status.value = 'done'
      console.log('[code-flow][frontend][state] status=done (stream completed)')
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
    errorMessage,
    detectedLanguage,
    generateFlow,
    isLoading,
    mappings,
    mermaid,
    resetOutput,
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
