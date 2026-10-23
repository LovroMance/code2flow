import { http } from './http'
import {
  parseDraft,
  parseMultiDetail,
  parseMultiResult,
  parseSnapshot,
  record,
  type MultiDraft,
  type SourceFileInput,
  type MultiFileResult
} from '../../entities/flow/model/multifile'

const sessionPath = (id: string) => `/v2/sessions/${encodeURIComponent(id)}`
export async function getMultiDetail(id: string) {
  return parseMultiDetail((await http.get(sessionPath(id))).data)
}
export async function saveMultiDraft(id: string, draft: MultiDraft) {
  return parseDraft((await http.patch(`${sessionPath(id)}/draft`, draft)).data)
}
export async function createSnapshot(id: string, files: SourceFileInput[]) {
  return parseSnapshot((await http.post(`${sessionPath(id)}/snapshots`, { files })).data)
}
export async function getSourceFile(id: string, snapshotId: string, fileId: string) {
  const data = record(
    (
      await http.get(
        `${sessionPath(id)}/snapshots/${encodeURIComponent(snapshotId)}/files/${encodeURIComponent(fileId)}`
      )
    ).data
  )
  if (data.fileId !== fileId || typeof data.content !== 'string') throw new Error('源码响应无效。')
  return data.content
}
export async function multiFollowUp(id: string, snapshotId: string, question: string) {
  const data = record(
    (await http.post('/v2/follow-up', { thread_id: id, snapshotId, question }, { timeout: 900000 }))
      .data
  )
  if (typeof data.explanation !== 'string') throw new Error('追问响应无效。')
  return { explanation: data.explanation }
}
/** fetch 消费 SSE 并组装完整结果；必须收到 done 且快照/任务身份一致才算成功。 */
export async function streamMultiFlow(
  id: string,
  snapshotId: string,
  signal: AbortSignal,
  onMetadata: (metadata: Record<string, unknown>) => void
): Promise<MultiFileResult> {
  const response = await fetch('/api/v2/generate-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: id, snapshotId }),
    signal
  })
  if (!response.ok || !response.body) throw new Error('多文件生成请求失败。')
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let buffer = '',
    metadata: Record<string, unknown> | undefined,
    mermaid: unknown,
    mappings: unknown,
    done = false,
    analysisId = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((l) => l.startsWith('data: '))
        if (!line) continue
        const event = record(JSON.parse(line.slice(6)))
        if (done) throw new Error('终止事件后收到额外数据。')
        if (event.type === 'error')
          throw new Error(typeof event.content === 'string' ? event.content : '分析失败。')
        if (event.type === 'metadata') {
          const data = record(event.content)
          if (
            data.version !== 2 ||
            data.snapshotId !== snapshotId ||
            typeof data.analysisId !== 'string' ||
            (analysisId && analysisId !== data.analysisId)
          )
            throw new Error('生成快照或分析身份不一致。')
          analysisId = data.analysisId
          metadata = data
          onMetadata(data)
        } else if (event.type === 'mermaid') mermaid = event.content
        else if (event.type === 'mappings') mappings = event.content
        else if (event.type === 'done') done = true
        else throw new Error('未知的流式事件。')
      }
    }
    if (!done) throw new Error('连接中断，未收到完整成功结果。')
    return parseMultiResult({ ...metadata, mermaid, mappings })
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
