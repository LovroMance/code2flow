import { http } from './http'
import {
  parseSessionDetail,
  parseSessionList,
  type SessionWrite
} from '../../entities/session/model/types'

const path = (id: string) => `/sessions/${encodeURIComponent(id)}`
export async function getSessions() {
  return parseSessionList((await http.get<unknown>('/sessions')).data)
}
export async function getSession(id: string) {
  return parseSessionDetail((await http.get<unknown>(path(id))).data)
}
export async function createSession(id: string, input: SessionWrite) {
  return parseSessionDetail((await http.post<unknown>('/sessions', { id, ...input })).data)
}
export async function updateSession(id: string, input: SessionWrite) {
  return parseSessionDetail((await http.patch<unknown>(path(id), input)).data)
}
export async function deleteSession(id: string) {
  await http.delete(path(id))
}
