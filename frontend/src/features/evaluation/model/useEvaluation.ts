import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  fetchCurrentEvaluation, fetchEvaluationDatasets, fetchEvaluationRuns, startEvaluation,
  type EvaluationDataset, type EvaluationRun
} from '../../../shared/api/evaluation.api'
import { getErrorMessage } from '../../../shared/lib/errorMessage'

export function useEvaluation() {
  const datasets = ref<EvaluationDataset[]>([])
  const datasetId = ref('')
  const experimentName = ref('')
  const runs = ref<EvaluationRun[]>([])
  const selectedRunId = ref('')
  const baselineId = ref('')
  const loading = ref(false)
  const loadingHistory = ref(false)
  const starting = ref(false)
  const error = ref('')
  const activeRun = computed(() => runs.value.find((run) => run.status === 'running'))
  const selectedRun = computed(() => runs.value.find((run) => run.id === selectedRunId.value))
  const baselines = computed(() => {
    const current = selectedRun.value
    if (current?.status !== 'completed' || !current.datasetVersion) return []
    return runs.value.filter((run) => run.id !== current.id && run.status === 'completed' &&
      run.datasetVersion === current.datasetVersion)
  })
  const baseline = computed(() => baselines.value.find((run) => run.id === baselineId.value))
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestVersion = 0
  let disposed = false

  function saveRun(run: EvaluationRun) {
    runs.value = [run, ...runs.value.filter((item) => item.id !== run.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async function poll(id: string, version: number) {
    if (disposed || requestVersion !== version) return
    try {
      const run = await fetchCurrentEvaluation(id)
      if (disposed || requestVersion !== version) return
      if (run) {
        saveRun(run)
        if (!selectedRunId.value) selectedRunId.value = run.id
        if (run.status !== 'running') return
      } else {
        if (activeRun.value) {
          runs.value = runs.value.filter((item) => item.status !== 'running')
          void loadRuns()
        }
        return
      }
    } catch {
      if (disposed || requestVersion !== version || !activeRun.value) return
    }
    timer = setTimeout(() => void poll(id, version), 1500)
  }

  async function loadRuns() {
    const id = datasetId.value
    if (!id) return
    clearTimeout(timer)
    const version = ++requestVersion
    loadingHistory.value = true
    error.value = ''
    try {
      const next = await fetchEvaluationRuns(id)
      if (disposed || requestVersion !== version) return
      runs.value = next
      if (!next.some((run) => run.id === selectedRunId.value)) selectedRunId.value = next[0]?.id ?? ''
    } catch (cause) {
      if (requestVersion === version) error.value = getErrorMessage(cause, '读取评测历史失败。')
    } finally {
      if (requestVersion === version) loadingHistory.value = false
    }
    if (requestVersion === version) void poll(id, version)
  }

  async function loadDatasets() {
    loading.value = true
    error.value = ''
    try {
      const next = await fetchEvaluationDatasets()
      if (disposed) return
      datasets.value = next
      if (!next.some((dataset) => dataset.id === datasetId.value)) {
        datasetId.value = next.find((dataset) => dataset.name === 'code2flow-regression')?.id ?? next[0]?.id ?? ''
      } else {
        await loadRuns()
      }
    } catch (cause) {
      if (!disposed) error.value = getErrorMessage(cause, '读取 LangSmith 数据集失败。')
    } finally {
      loading.value = false
    }
  }

  async function runEvaluation() {
    if (!datasetId.value || starting.value || activeRun.value) return
    starting.value = true
    error.value = ''
    try {
      const run = await startEvaluation(datasetId.value, experimentName.value.trim())
      if (disposed) return
      clearTimeout(timer)
      loadingHistory.value = false
      saveRun(run)
      selectedRunId.value = run.id
      void poll(run.datasetId, ++requestVersion)
    } catch (cause) {
      if (!disposed) error.value = getErrorMessage(cause, '启动评测失败。')
    } finally {
      starting.value = false
    }
  }

  watch(datasetId, () => {
    runs.value = []
    selectedRunId.value = ''
    baselineId.value = ''
    void loadRuns()
  })
  watch(selectedRunId, () => { baselineId.value = '' })
  onMounted(() => void loadDatasets())
  onUnmounted(() => {
    disposed = true
    clearTimeout(timer)
  })

  return {
    datasets, datasetId, experimentName, runs, selectedRunId, selectedRun, baselineId, baseline,
    baselines, loading, loadingHistory, starting, error, activeRun, loadDatasets, runEvaluation
  }
}
