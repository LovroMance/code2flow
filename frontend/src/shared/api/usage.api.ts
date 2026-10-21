import { parseUsageList } from '../../entities/usage/model/types'
import { http } from './http'

export async function fetchGenerationUsage() {
  const response = await http.get<unknown>('/usage')
  return parseUsageList(response.data)
}
