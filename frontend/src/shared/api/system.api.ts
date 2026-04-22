import type { HealthResponse } from '../../entities/flow/model/types'
import { http } from './http'

export async function getHealth() {
  const { data } = await http.get<HealthResponse>('/health')
  return data
}
