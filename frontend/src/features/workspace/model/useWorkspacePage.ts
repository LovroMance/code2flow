import { computed, onMounted, ref } from 'vue'
import { SAMPLE_CODE } from '../config/sampleCode'
import { getHealth } from '../../../shared/api/system.api'
import { postFollowUp } from '../../../shared/api/follow-up.api'
import { useFlowGeneration } from '../../flow-generation/model/useFlowGeneration'
import type { NodeMapping, SupportedLanguage } from '../../../entities/flow/model/types'
import {
  SUPPORTED_FILE_EXTENSIONS,
  inferLanguageFromExtension
} from '../../../entities/flow/model/languages'

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024
const DEFAULT_LANGUAGE: SupportedLanguage = 'javascript'

export function useWorkspacePage() {
  const code = ref(SAMPLE_CODE)
  const healthStatus = ref('checking')
  const uploadFileName = ref('')
  const uploadErrorMessage = ref('')
  const threadId = ref(createThreadId())
  const followUpQuestion = ref('')
  const followUpAnswer = ref('')
  const followUpErrorMessage = ref('')
  const followUpStatus = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
  const {
    detectedLanguage,
    errorMessage,
    generateFlow,
    isLoading,
    mappings,
    mermaid,
    resetOutput,
    setDetectedLanguage,
    status
  } = useFlowGeneration()

  const combinedErrorMessage = computed(
    () => uploadErrorMessage.value || followUpErrorMessage.value || errorMessage.value
  )
  const threadLabel = computed(() => threadId.value.slice(0, 8))
  const canAskFollowUp = computed(
    () =>
      status.value === 'done' &&
      mappings.value.length > 0 &&
      !isLoading.value &&
      followUpStatus.value !== 'loading'
  )

  const statusText = computed(() => {
    if (status.value === 'streaming') {
      return 'streaming'
    }

    if (status.value === 'done') {
      return 'done'
    }

    if (status.value === 'error') {
      return 'error'
    }

    return 'idle'
  })

  const followUpStatusText = computed(() => {
    if (followUpStatus.value === 'loading') {
      return 'thinking'
    }

    if (followUpStatus.value === 'done') {
      return 'answered'
    }

    if (followUpStatus.value === 'error') {
      return 'error'
    }

    return 'idle'
  })

  async function handleGenerate() {
    if (!code.value.trim()) {
      return
    }

    uploadErrorMessage.value = ''

    try {
      await generateFlow({
        code: code.value,
        threadId: threadId.value
      })
    } catch (error) {
      console.error(error)
    }
  }

  // 新会话会刷新 threadId，让后端后续接入 checkpoint 时能按线程隔离上下文。
  function resetSession() {
    threadId.value = createThreadId()
    followUpQuestion.value = ''
    followUpAnswer.value = ''
    followUpErrorMessage.value = ''
    followUpStatus.value = 'idle'
    console.log(`[code-flow][frontend][session] reset threadId=${threadId.value}`)
  }

  async function handleFollowUp() {
    if (!canAskFollowUp.value || !followUpQuestion.value.trim()) {
      return
    }

    followUpStatus.value = 'loading'
    followUpErrorMessage.value = ''
    console.log(
      `[code-flow][frontend][followup] request-start threadId=${threadId.value} questionLength=${followUpQuestion.value.trim().length}`
    )

    try {
      const response = await postFollowUp({
        threadId: threadId.value,
        question: followUpQuestion.value.trim(),
        code: code.value
      })

      followUpAnswer.value = response.explanation
      followUpStatus.value = 'done'
      console.log('[code-flow][frontend][followup] request-done')
    } catch (error) {
      console.error(error)
      followUpStatus.value = 'error'
      followUpErrorMessage.value = '追问失败，请确认当前会话已经生成过流程图后再试。'
    }
  }

  function loadSample() {
    code.value = SAMPLE_CODE
    uploadFileName.value = ''
    uploadErrorMessage.value = ''
    resetSession()
    setDetectedLanguage(DEFAULT_LANGUAGE)
    resetOutput()
  }

  function clearWorkspace() {
    code.value = ''
    uploadFileName.value = ''
    uploadErrorMessage.value = ''
    resetSession()
    setDetectedLanguage(DEFAULT_LANGUAGE)
    resetOutput()
  }

  async function handleUploadFile(file: File | null | undefined) {
    if (!file) {
      return
    }

    uploadErrorMessage.value = ''

    const normalizedName = file.name.trim()
    const fileExtension = normalizedName.includes('.')
      ? normalizedName.slice(normalizedName.lastIndexOf('.')).toLowerCase()
      : ''

    if (
      !SUPPORTED_FILE_EXTENSIONS.includes(
        fileExtension as (typeof SUPPORTED_FILE_EXTENSIONS)[number]
      )
    ) {
      uploadErrorMessage.value = `暂不支持 ${fileExtension || '该类型'} 文件，请上传常见文本代码文件。`
      return
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      uploadErrorMessage.value = `文件过大，请上传小于 ${Math.floor(MAX_UPLOAD_SIZE_BYTES / 1024)}KB 的代码文件。`
      return
    }

    try {
      const content = await file.text()

      if (!content.trim()) {
        uploadErrorMessage.value = '文件内容为空，未检测到可分析的代码。'
        return
      }

      code.value = content
      uploadFileName.value = normalizedName
      resetSession()
      setDetectedLanguage(inferLanguageFromExtension(fileExtension))
      resetOutput()
    } catch (error) {
      console.error(error)
      uploadErrorMessage.value = '读取文件失败，请稍后重试。'
    }
  }

  function handleLanguageChange(language: SupportedLanguage) {
    setDetectedLanguage(language)
  }

  function findMappingByNodeId(nodeId: string): NodeMapping | undefined {
    return mappings.value.find((mapping) => mapping.nodeId === nodeId)
  }

  // 点击图节点时顺手生成一条带行号和节点标签的追问草稿，方便直接追问。
  function primeFollowUpQuestionFromNode(nodeId: string) {
    const mapping = findMappingByNodeId(nodeId)

    if (!mapping) {
      return undefined
    }

    followUpQuestion.value = `为什么节点「${mapping.label}」会被画成 ${mapping.kind} 类型？它对应的第 ${mapping.lineStart}-${mapping.lineEnd} 行逻辑在流程图里为什么这样连接？`
    followUpAnswer.value = ''
    followUpErrorMessage.value = ''
    followUpStatus.value = 'idle'

    return mapping
  }

  onMounted(async () => {
    try {
      const health = await getHealth()
      healthStatus.value = health.ok ? 'online' : 'offline'
    } catch (error) {
      console.error(error)
      healthStatus.value = 'offline'
    }
  })

  return {
    code,
    clearWorkspace,
    detectedLanguage,
    errorMessage: combinedErrorMessage,
    followUpAnswer,
    followUpQuestion,
    followUpStatus,
    followUpStatusText,
    handleGenerate,
    handleFollowUp,
    handleLanguageChange,
    handleUploadFile,
    healthStatus,
    isLoading,
    canAskFollowUp,
    loadSample,
    mappings,
    mermaid,
    resetSession,
    findMappingByNodeId,
    primeFollowUpQuestionFromNode,
    status,
    statusText,
    threadId,
    threadLabel,
    uploadFileName
  }
}

function createThreadId() {
  return crypto.randomUUID()
}
