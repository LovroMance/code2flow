import { computed, onMounted, ref } from 'vue'
import { SAMPLE_CODE } from '../config/sampleCode'
import { getHealth } from '../../../shared/api/system.api'
import { useFlowGeneration } from '../../flow-generation/model/useFlowGeneration'
import type { NodeMapping } from '../../../entities/flow/model/types'

const SUPPORTED_FILE_EXTENSIONS = [
  '.js',
  '.ts',
  '.vue',
  '.jsx',
  '.tsx',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.py',
  '.go',
  '.rs',
  '.cs',
  '.php'
] as const

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024

export function useWorkspacePage() {
  const code = ref(SAMPLE_CODE)
  const healthStatus = ref('checking')
  const uploadFileName = ref('')
  const uploadErrorMessage = ref('')
  const { errorMessage, generateFlow, isLoading, mappings, mermaid, resetOutput, status } =
    useFlowGeneration()

  const combinedErrorMessage = computed(() => uploadErrorMessage.value || errorMessage.value)

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

  async function handleGenerate() {
    if (!code.value.trim()) {
      return
    }

    uploadErrorMessage.value = ''

    try {
      await generateFlow(code.value)
    } catch (error) {
      console.error(error)
    }
  }

  function loadSample() {
    code.value = SAMPLE_CODE
    uploadFileName.value = ''
    uploadErrorMessage.value = ''
    resetOutput()
  }

  function clearWorkspace() {
    code.value = ''
    uploadFileName.value = ''
    uploadErrorMessage.value = ''
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
      resetOutput()
    } catch (error) {
      console.error(error)
      uploadErrorMessage.value = '读取文件失败，请稍后重试。'
    }
  }

  function findMappingByNodeId(nodeId: string): NodeMapping | undefined {
    return mappings.value.find((mapping) => mapping.nodeId === nodeId)
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
    errorMessage: combinedErrorMessage,
    handleGenerate,
    handleUploadFile,
    healthStatus,
    isLoading,
    loadSample,
    mappings,
    mermaid,
    findMappingByNodeId,
    status,
    statusText,
    uploadFileName
  }
}
