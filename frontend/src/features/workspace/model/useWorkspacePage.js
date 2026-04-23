import { computed, onMounted, ref } from 'vue'
import { SAMPLE_CODE } from '../config/sampleCode'
import { getHealth } from '../../../shared/api/system.api'
import { useFlowGeneration } from '../../flow-generation/model/useFlowGeneration'
export function useWorkspacePage() {
  const code = ref(SAMPLE_CODE)
  const healthStatus = ref('checking')
  const { errorMessage, generateFlow, isLoading, mappings, mermaid, resetOutput, status } =
    useFlowGeneration()
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
    try {
      await generateFlow(code.value)
    } catch (error) {
      console.error(error)
    }
  }
  function loadSample() {
    code.value = SAMPLE_CODE
  }
  function clearWorkspace() {
    code.value = ''
    resetOutput()
  }
  function findMappingByNodeId(nodeId) {
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
    errorMessage,
    handleGenerate,
    healthStatus,
    isLoading,
    loadSample,
    mappings,
    mermaid,
    findMappingByNodeId,
    status,
    statusText
  }
}
