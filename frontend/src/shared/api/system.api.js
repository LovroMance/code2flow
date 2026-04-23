import { http } from './http'
export async function getHealth() {
  const { data } = await http.get('/health')
  return data
}
