import { randomUUID } from 'node:crypto'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import {
  SessionSummarySchema,
  type SessionMetadata,
  type SessionWrite
} from '../domain/session/schema'
import { SessionRepository } from '../repositories/session.repository'
import { SourceRepository } from '../repositories/source.repository'
import { createMultiFileGraph } from '../ai/graph/multifile.graph'
import { sha256 } from '../utils/sourcePositions'
import { isSessionBusy, SessionError, withSessionLock } from './session-lock'

const services = new WeakMap<SqliteSaver, SessionService>()

export function getSessionService() {
  const saver = getCodeFlowCheckpointer()
  let service = services.get(saver)
  if (!service) {
    service = new SessionService(saver)
    services.set(saver, service)
  }
  return service
}

export class SessionService {
  private readonly repository: SessionRepository
  private readonly sources: SourceRepository

  constructor(private readonly saver: SqliteSaver) {
    this.repository = new SessionRepository(saver)
    this.sources = new SourceRepository(saver)
  }

  ensure(id: string, input: SessionWrite = {}) {
    if (this.repository.wasDeleted(id)) throw new SessionError('该会话已删除，请新建会话。', 404)
    const previous = this.repository.get(id)
    if (previous) return previous
    const now = new Date().toISOString()
    const metadata: SessionMetadata = {
      id,
      title: input.title ?? (input.fileName || '未命名分析'),
      fileName: input.fileName ?? '',
      createdAt: now,
      updatedAt: now,
      draftLanguage: input.draftLanguage ?? 'unknown'
    }
    this.repository.save(metadata)
    return metadata
  }

  private async summary(metadata: SessionMetadata) {
    const draft = this.sources.draft(metadata.id)
    const threadId = draft?.files.length === 0 ? null : this.sources.analysisThread(metadata.id, false)
    const analysis = threadId
      ? (await createMultiFileGraph(undefined, this.saver).getState({
          configurable: { thread_id: threadId }
        })).values
      : null
    const snapshot = analysis?.snapshotId ? this.sources.get(metadata.id, analysis.snapshotId) : null
    const hasDraft = !!draft?.files.length &&
      (!snapshot ||
        draft.files.length !== snapshot.files.length ||
        draft.files.some(({ path, content }) =>
          snapshot.files.find((file) => file.path === path)?.contentHash !== sha256(content)
        ))
    return SessionSummarySchema.parse({
      ...metadata,
      language: analysis?.languageDetection?.language ?? metadata.draftLanguage,
      hasResult: !!analysis?.result,
      hasDraft,
      busy: isSessionBusy(metadata.id)
    })
  }

  async list() {
    return Promise.all(this.repository.list().map((metadata) => this.summary(metadata)))
  }

  async get(id: string) {
    const metadata = this.repository.get(id)
    if (!metadata) throw new SessionError('会话不存在或已被删除。', 404)
    return this.summary(metadata)
  }

  async create(input: SessionWrite & { id?: string }) {
    const id = input.id ?? randomUUID()
    await withSessionLock(id, async () => {
      if (this.repository.get(id)) {
        throw new SessionError('会话 ID 已存在，请刷新列表。', 409)
      }
      this.ensure(id, input)
    })
    return this.get(id)
  }

  async update(id: string, input: SessionWrite) {
    await withSessionLock(id, async () => {
      const metadata = this.repository.get(id)
      if (!metadata) throw new SessionError('会话不存在或已被删除。', 404)
      this.repository.save({ ...metadata, ...input, updatedAt: new Date().toISOString() })
    })
    return this.get(id)
  }

  async delete(id: string) {
    return withSessionLock(id, async () => {
      if (!this.repository.get(id)) throw new SessionError('会话不存在或已被删除。', 404)
      const analysisThread = this.sources.analysisThread(id, false)
      if (analysisThread) await this.saver.deleteThread(analysisThread)
      this.sources.deleteSession(id)
      this.repository.delete(id)
    })
  }
}
