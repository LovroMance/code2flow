import { randomUUID } from 'node:crypto'
import { isBaseMessage } from '@langchain/core/messages'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { z } from 'zod'
import { createCodeFlowGraph } from '../ai/graph/code-flow.graph'
import { getCodeFlowCheckpointer } from '../ai/graph/checkpointer'
import { GenerationResultSchema } from '../domain/flow/schema'
import { SupportedLanguageSchema } from '../domain/flow/language'
import {
  SessionDetailSchema,
  SessionSummarySchema,
  type SessionMetadata,
  type SessionWrite
} from '../domain/session/schema'
import { SessionRepository } from '../repositories/session.repository'
import { SourceRepository } from '../repositories/source.repository'
import { createMultiFileGraph } from '../ai/graph/multifile.graph'
import { sha256 } from '../utils/sourcePositions'
import { isSessionBusy, SessionError, withSessionLock } from './session-lock'

const SnapshotSchema = z.object({
  code: z.string().default(''),
  detectedLanguage: SupportedLanguageSchema.default('unknown'),
  result: GenerationResultSchema.nullable().default(null),
  messages: z.array(z.unknown()).default([]),
  error: z.string().nullable().default(null)
})
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
  private indexed = false
  private indexing: Promise<void> | undefined

  constructor(private readonly saver: SqliteSaver) {
    this.repository = new SessionRepository(saver)
    this.sources = new SourceRepository(saver)
  }

  private async snapshot(id: string) {
    const state = await createCodeFlowGraph({ checkpointer: this.saver }).getState({
      configurable: { thread_id: id }
    })
    return SnapshotSchema.parse(state.values)
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
      draftCode: input.draftCode ?? null,
      draftLanguage: input.draftLanguage ?? 'unknown'
    }
    this.repository.save(metadata)
    return metadata
  }

  touch(id: string) {
    const metadata = this.ensure(id)
    this.repository.save({ ...metadata, updatedAt: new Date().toISOString() })
  }

  // 首次访问把已有 SQLite 检查点登记为会话，不复制检查点内容。
  private async indexExisting() {
    if (this.indexed) return
    this.indexing ??= (async () => {
      const seen = new Set<string>()
      for await (const item of this.saver.list({})) {
        const id = item.config.configurable?.thread_id
        if (typeof id !== 'string' || this.sources.isAnalysisThread(id) || seen.has(id)) continue
        seen.add(id)
        if (this.repository.get(id) || this.repository.wasDeleted(id)) continue
        this.repository.save({
          id,
          title: `历史分析 ${id.slice(0, 8)}`,
          fileName: '',
          createdAt: item.checkpoint.ts,
          updatedAt: item.checkpoint.ts,
          draftCode: null,
          draftLanguage: 'unknown'
        })
      }
      this.indexed = true
    })()
    try {
      await this.indexing
    } finally {
      this.indexing = undefined
    }
  }

  private async summary(metadata: SessionMetadata, snapshot: z.infer<typeof SnapshotSchema>) {
    const draft = this.sources.draft(metadata.id)
    if (draft?.files.length) {
      const state = await createMultiFileGraph(undefined, this.saver).getState({
        configurable: { thread_id: this.sources.analysisThread(metadata.id)! }
      })
      const source = state.values.snapshotId
        ? this.sources.get(metadata.id, state.values.snapshotId)
        : null
      const changed =
        !source ||
        draft.files.length !== source.files.length ||
        draft.files.some(
          (file) =>
            !source.files.some(
              (old) => old.path === file.path && old.contentHash === sha256(file.content)
            )
        )
      return SessionSummarySchema.parse({
        ...metadata,
        language: state.values.languageDetection?.language ?? metadata.draftLanguage,
        hasResult: !!state.values.result,
        hasDraft: changed,
        busy: isSessionBusy(metadata.id)
      })
    }
    return SessionSummarySchema.parse({
      ...metadata,
      language: metadata.draftCode === null ? snapshot.detectedLanguage : metadata.draftLanguage,
      hasResult: !!snapshot.result,
      hasDraft: metadata.draftCode !== null && metadata.draftCode !== snapshot.code,
      busy: isSessionBusy(metadata.id)
    })
  }

  async list() {
    await this.indexExisting()
    return Promise.all(
      this.repository
        .list()
        .map(async (metadata) => this.summary(metadata, await this.snapshot(metadata.id)))
    )
  }

  async get(id: string) {
    await this.indexExisting()
    const metadata = this.repository.get(id)
    if (!metadata) throw new SessionError('会话不存在或已被删除。', 404)
    const snapshot = await this.snapshot(id)
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const message of snapshot.messages) {
      if (!isBaseMessage(message)) continue
      const type = message.getType()
      if (type === 'human' || type === 'ai') {
        messages.push({ role: type === 'human' ? 'user' : 'assistant', content: message.text })
      }
    }
    return SessionDetailSchema.parse({
      ...(await this.summary(metadata, snapshot)),
      draftCode: metadata.draftCode ?? snapshot.code,
      draftLanguage:
        metadata.draftCode === null ? snapshot.detectedLanguage : metadata.draftLanguage,
      sourceCode: snapshot.code,
      result: snapshot.result,
      messages,
      failed: !!snapshot.error
    })
  }

  async create(input: SessionWrite & { id?: string }) {
    const id = input.id ?? randomUUID()
    await withSessionLock(id, async () => {
      // 调用者重试创建时复用同一 ID，禁止意外覆盖已有会话。
      if (
        this.repository.get(id) ||
        (await this.saver.getTuple({ configurable: { thread_id: id } }))
      ) {
        throw new SessionError('会话 ID 已存在，请刷新列表。', 409)
      }
      this.ensure(id, input)
    })
    return this.get(id)
  }

  async update(id: string, input: SessionWrite) {
    await withSessionLock(id, async () => {
      await this.indexExisting()
      const metadata = this.repository.get(id)
      if (!metadata) throw new SessionError('会话不存在或已被删除。', 404)
      this.repository.save({ ...metadata, ...input, updatedAt: new Date().toISOString() })
    })
    return this.get(id)
  }

  async delete(id: string) {
    return withSessionLock(id, async () => {
      await this.indexExisting()
      if (!this.repository.get(id)) throw new SessionError('会话不存在或已被删除。', 404)
      await this.saver.deleteThread(id)
      const analysisThread = this.sources.analysisThread(id, false)
      if (analysisThread) await this.saver.deleteThread(analysisThread)
      this.sources.deleteSession(id)
      this.repository.delete(id)
    })
  }
}
