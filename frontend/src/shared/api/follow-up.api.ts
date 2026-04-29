import type { FollowUpResponse } from '../../entities/flow/model/types'
import { http } from './http'

// follow-up 请求复用当前 thread_id，让后端能从同一会话上下文里恢复上次分析结果。
export async function postFollowUp(input: { threadId: string; question: string; code: string }) {
  const { data } = await http.post<FollowUpResponse>('/follow-up', {
    thread_id: input.threadId,
    question: input.question,
    code: input.code
  })

  return data
}
