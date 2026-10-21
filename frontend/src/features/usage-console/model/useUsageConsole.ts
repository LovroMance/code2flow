import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UsageList } from '../../../entities/usage/model/types'
import { fetchGenerationUsage } from '../../../shared/api/usage.api'

export function useUsageConsole() {
  const data = ref<UsageList | null>(null)
  const loading = ref(false)
  const error = ref('')
  let disposed = false

  async function refresh() {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const result = await fetchGenerationUsage()
      if (!disposed) data.value = result
    } catch {
      if (!disposed) error.value = '读取用量记录失败，请检查后端服务后重试。'
    } finally {
      if (!disposed) loading.value = false
    }
  }

  onMounted(refresh)
  onBeforeUnmount(() => {
    disposed = true
  })
  return { data, loading, error, refresh }
}
