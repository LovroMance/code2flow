import { randomUUID } from 'node:crypto'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { z } from 'zod'
import {
  DraftSchema,
  CodeChunkSchema,
  SourceSnapshotSchema,
  type SourceFileInput,
  type SourceSnapshot,
  type CodeChunk
} from '../domain/source/schema'
import {
  lineOffsets,
  normalizeSourcePath,
  sha256,
  chunkSource,
  missingRanges,
  validateSourceRange
} from '../utils/sourcePositions'
import { SessionError } from '../services/session-lock'
import { SOURCE_LIMITS, MultiConfigurationError } from '../services/multifile-config'
import {
  FileSemanticIndexSchema,
  type FileSemanticIndex,
  type CrossFileReference
} from '../domain/multifile/schema'
import type { Evidence } from '../domain/source/schema'
import { keywordFields, chunkSemanticFields } from '../utils/searchFields'

const JsonRow = z.object({ data: z.string() })
/** 复用官方 SqliteSaver 的连接保存业务数据；框架 checkpoint 仍由 saver 自己管理。 */
export class SourceRepository {
  readonly db: SqliteSaver['db']
  readonly hasFts: boolean
  constructor(saver: SqliteSaver) {
    this.db = saver.db
    // 业务版本迁移只操作自己的表，绝不依赖 saver 内部表结构。
    this.db.transaction(() => {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS code_flow_source_migrations (version INTEGER PRIMARY KEY)'
      )
      const current =
        z
          .object({ version: z.number().nullable() })
          .parse(
            this.db.prepare('SELECT MAX(version) AS version FROM code_flow_source_migrations').get()
          ).version ?? 0
      if (current >= 3) return
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS code_flow_source_migrations (version INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS code_flow_source_blobs (hash TEXT PRIMARY KEY, content TEXT NOT NULL, bytes INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS code_flow_source_positions (hash TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS code_flow_chunk_templates (hash TEXT NOT NULL, version TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(hash,version));
        CREATE TABLE IF NOT EXISTS code_flow_snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, manifest TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS code_flow_snapshots_owner ON code_flow_snapshots(session_id);
        CREATE TABLE IF NOT EXISTS code_flow_snapshot_files (snapshot_id TEXT NOT NULL, file_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(snapshot_id,file_id));
        CREATE TABLE IF NOT EXISTS code_flow_chunks (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, file_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
        CREATE TABLE IF NOT EXISTS code_flow_file_indexes (session_id TEXT NOT NULL, cache_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,cache_key));
        CREATE TABLE IF NOT EXISTS code_flow_analysis_tasks (session_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, task_id TEXT NOT NULL, attempts INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,task_id));
        CREATE TABLE IF NOT EXISTS code_flow_embeddings (input_hash TEXT NOT NULL, model TEXT NOT NULL, dimension INTEGER NOT NULL, version TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(input_hash,model,version));
        CREATE TABLE IF NOT EXISTS code_flow_embedding_refs (snapshot_id TEXT NOT NULL, input_hash TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY(snapshot_id,input_hash,model));
        CREATE TABLE IF NOT EXISTS code_flow_workspace_drafts (session_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS code_flow_multifile_threads (session_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS code_flow_semantic_indexes (snapshot_id TEXT NOT NULL, file_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,file_id));
        CREATE TABLE IF NOT EXISTS code_flow_units (snapshot_id TEXT NOT NULL, unit_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,unit_id));
        CREATE TABLE IF NOT EXISTS code_flow_references (snapshot_id TEXT NOT NULL, reference_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,reference_id));
        CREATE TABLE IF NOT EXISTS code_flow_evidence (snapshot_id TEXT NOT NULL, evidence_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,evidence_id));
        INSERT OR IGNORE INTO code_flow_source_migrations(version) VALUES(1);
        INSERT OR IGNORE INTO code_flow_source_migrations(version) VALUES(2);
        INSERT OR IGNORE INTO code_flow_source_migrations(version) VALUES(3);`)
    })()
    try {
      this.db.exec(
        'CREATE VIRTUAL TABLE IF NOT EXISTS code_flow_chunks_fts USING fts5(snapshot_id UNINDEXED, chunk_id UNINDEXED, text)'
      )
      this.hasFts = true
    } catch {
      this.hasFts = false
    }
  }
  /** 校验路径唯一性、内容及上传体积，返回归一化文件集合。 */
  validateFiles(files: SourceFileInput[], maxFiles = 20, maxBytes = 2097152) {
    if (
      !Number.isInteger(maxFiles) ||
      maxFiles < 1 ||
      maxFiles > 1000 ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 1
    )
      throw new MultiConfigurationError('多文件数量或总字节上限配置无效。')
    if (!files.length || files.length > maxFiles)
      throw new SessionError(`最多上传 ${maxFiles} 个文件。`, 400)
    const seen = new Set<string>()
    let total = 0
    return files.map((file) => {
      const path = normalizeSourcePath(file.path),
        bytes = Buffer.byteLength(file.content, 'utf8')
      if (seen.has(path)) throw new SessionError(`路径重复：${path}`, 400)
      if (
        !file.content.replace(/^\uFEFF/, '').trim() ||
        [...file.content].some((c) => c.charCodeAt(0) < 32 && !'\t\r\n'.includes(c)) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(file.content)
      )
        throw new SessionError(`文件为空、二进制或 UTF-8 无效：${path}`, 400)
      total += bytes
      if (bytes > SOURCE_LIMITS.maxFileBytes || total > maxBytes)
        throw new SessionError(`文件 ${path} 超过单文件 200 KiB 或总大小限制。`, 400)
      seen.add(path)
      return { path, content: file.content }
    })
  }
  /** 路径排序后计算清单哈希，同会话相同清单复用快照；正文按哈希去重。 */
  create(sessionId: string, files: SourceFileInput[]) {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
    const manifestHash = sha256(
      JSON.stringify(sorted.map((file) => [file.path, sha256(file.content)]))
    )
    const old: unknown = this.db
      .prepare('SELECT data FROM code_flow_snapshots WHERE session_id = ? AND manifest = ? LIMIT 1')
      .get(sessionId, manifestHash)
    if (old) return SourceSnapshotSchema.parse(JSON.parse(JsonRow.parse(old).data))
    const snapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      sessionId,
      manifestHash,
      languageDetection: null,
      files: sorted.map((file) => ({
        fileId: randomUUID(),
        path: file.path,
        contentHash: sha256(file.content),
        byteSize: Buffer.byteLength(file.content),
        lineCount: lineOffsets(file.content).length
      }))
    }
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO code_flow_snapshots VALUES(?,?,?,?)')
        .run(snapshot.snapshotId, sessionId, manifestHash, JSON.stringify(snapshot))
      sorted.forEach((file, i) => {
        const member = snapshot.files[i]!
        this.db
          .prepare('INSERT OR IGNORE INTO code_flow_source_blobs VALUES(?,?,?)')
          .run(member.contentHash, file.content, member.byteSize)
        this.db
          .prepare('INSERT OR IGNORE INTO code_flow_source_positions VALUES(?,?)')
          .run(member.contentHash, JSON.stringify(lineOffsets(file.content)))
        this.db
          .prepare('INSERT INTO code_flow_snapshot_files VALUES(?,?,?)')
          .run(snapshot.snapshotId, member.fileId, member.contentHash)
      })
    })()
    return snapshot
  }
  get(sessionId: string, snapshotId: string) {
    const row: unknown = this.db
      .prepare('SELECT data FROM code_flow_snapshots WHERE id = ? AND session_id = ?')
      .get(snapshotId, sessionId)
    if (!row) throw new SessionError('快照不存在或不属于该会话。', 404)
    return SourceSnapshotSchema.parse(JSON.parse(JsonRow.parse(row).data))
  }
  saveDetection(snapshot: SourceSnapshot) {
    this.db
      .prepare('UPDATE code_flow_snapshots SET data = ? WHERE id = ? AND session_id = ?')
      .run(
        JSON.stringify(SourceSnapshotSchema.parse(snapshot)),
        snapshot.snapshotId,
        snapshot.sessionId
      )
  }
  /** 先确认文件是该快照成员，再取正文，禁止凭任意 fileId 跨快照读取。 */
  content(snapshot: SourceSnapshot, fileId: string) {
    const file = snapshot.files.find((file) => file.fileId === fileId)
    if (!file) throw new SessionError('文件不属于当前快照。', 404)
    const row: unknown = this.db
      .prepare('SELECT content FROM code_flow_source_blobs WHERE hash = ?')
      .get(file.contentHash)
    return z.object({ content: z.string() }).parse(row).content
  }
  saveChunks(snapshot: SourceSnapshot, chunks: CodeChunk[]) {
    const previous = this.chunks(snapshot)
    const canonical = (items: CodeChunk[]) =>
      JSON.stringify(
        [...items]
          .sort((a, b) => a.chunkId.localeCompare(b.chunkId))
          .map((item) => CodeChunkSchema.parse(item))
      )
    const ftsCount = this.hasFts
      ? z
          .object({ n: z.number() })
          .parse(
            this.db
              .prepare('SELECT COUNT(*) n FROM code_flow_chunks_fts WHERE snapshot_id=?')
              .get(snapshot.snapshotId)
          ).n
      : chunks.length
    if (ftsCount === chunks.length && canonical(previous) === canonical(chunks)) return
    const contents = new Map(
      snapshot.files.map((file) => [file.fileId, this.content(snapshot, file.fileId)])
    )
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM code_flow_chunks WHERE snapshot_id = ?').run(snapshot.snapshotId)
      if (this.hasFts)
        this.db
          .prepare('DELETE FROM code_flow_chunks_fts WHERE snapshot_id = ?')
          .run(snapshot.snapshotId)
      for (const chunk of chunks) {
        this.db
          .prepare('INSERT INTO code_flow_chunks VALUES(?,?,?,?)')
          .run(snapshot.snapshotId, chunk.chunkId, chunk.fileId, JSON.stringify(chunk))
        if (this.hasFts) {
          const path = snapshot.files.find((file) => file.fileId === chunk.fileId)!.path
          const text = `${path}\n${contents.get(chunk.fileId)!.slice(chunk.startOffset, chunk.endOffset)}`
          this.db
            .prepare('INSERT INTO code_flow_chunks_fts VALUES(?,?,?)')
            .run(snapshot.snapshotId, chunk.chunkId, keywordFields(text))
        }
      }
    })()
  }
  offsets(snapshot: SourceSnapshot, fileId: string) {
    const file = snapshot.files.find((file) => file.fileId === fileId)
    if (!file) throw new SessionError('文件不属于当前快照。', 404)
    const row: unknown = this.db
      .prepare('SELECT data FROM code_flow_source_positions WHERE hash=?')
      .get(file.contentHash)
    return row
      ? z.array(z.number().int().nonnegative()).parse(JSON.parse(JsonRow.parse(row).data))
      : lineOffsets(this.content(snapshot, fileId))
  }
  chunks(snapshot: SourceSnapshot) {
    const rows: unknown[] = this.db
      .prepare('SELECT data FROM code_flow_chunks WHERE snapshot_id=? ORDER BY file_id,id')
      .all(snapshot.snapshotId)
    return rows.map((row) => CodeChunkSchema.parse(JSON.parse(JsonRow.parse(row).data)))
  }
  /** 复用正文与切片版本匹配的基础块，并重新绑定当前快照的文件身份。 */
  basicChunks(snapshot: SourceSnapshot, maxChars = 8000) {
    return snapshot.files.flatMap((file) => {
      const version = `lines120-overlap20-chars${maxChars}-v1`,
        content = this.content(snapshot, file.fileId)
      this.db
        .prepare('INSERT OR IGNORE INTO code_flow_source_positions VALUES(?,?)')
        .run(file.contentHash, JSON.stringify(lineOffsets(content)))
      const row: unknown = this.db
        .prepare('SELECT data FROM code_flow_chunk_templates WHERE hash=? AND version=?')
        .get(file.contentHash, version)
      if (row) {
        try {
          const chunks = z
            .array(CodeChunkSchema)
            .parse(JSON.parse(JsonRow.parse(row).data))
            .map((chunk, index) => ({
              ...chunk,
              fileId: file.fileId,
              chunkId: `${file.fileId}_c${index}`
            }))
          const offsets = this.offsets(snapshot, file.fileId)
          chunks.forEach((chunk) => {
            if (chunk.contentHash !== file.contentHash || chunk.chunkerVersion !== version)
              throw new Error('分块缓存版本不匹配。')
            validateSourceRange(chunk, file.fileId, content, offsets)
          })
          if (missingRanges(content.length, chunks).length) throw new Error('分块缓存缺失范围。')
          return chunks
        } catch {
          this.db
            .prepare('DELETE FROM code_flow_chunk_templates WHERE hash=? AND version=?')
            .run(file.contentHash, version)
        }
      }
      const chunks = chunkSource(file.fileId, content, maxChars)
      this.db
        .prepare('INSERT OR REPLACE INTO code_flow_chunk_templates VALUES(?,?,?)')
        .run(file.contentHash, version, JSON.stringify(chunks))
      return chunks
    })
  }
  cacheGet(sessionId: string, key: string): unknown {
    const row: unknown = this.db
      .prepare('SELECT data FROM code_flow_file_indexes WHERE session_id = ? AND cache_key = ?')
      .get(sessionId, key)
    return row ? JSON.parse(JsonRow.parse(row).data) : undefined
  }
  cachePut(sessionId: string, key: string, data: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO code_flow_file_indexes VALUES(?,?,?)')
      .run(sessionId, key, JSON.stringify(data))
  }
  cacheDelete(sessionId: string, key: string) {
    this.db
      .prepare('DELETE FROM code_flow_file_indexes WHERE session_id=? AND cache_key=?')
      .run(sessionId, key)
  }
  /** 将用户会话映射到内部 v2 checkpoint 线程，避免覆盖旧单文件图状态。 */
  analysisThread(sessionId: string, create = true) {
    const row: unknown = this.db
      .prepare('SELECT thread_id FROM code_flow_multifile_threads WHERE session_id=?')
      .get(sessionId)
    if (row) return z.object({ thread_id: z.string() }).parse(row).thread_id
    if (!create) return null
    const threadId = `v2:${randomUUID()}`
    this.db.prepare('INSERT INTO code_flow_multifile_threads VALUES(?,?)').run(sessionId, threadId)
    return threadId
  }
  isAnalysisThread(threadId: string) {
    return !!this.db
      .prepare('SELECT session_id FROM code_flow_multifile_threads WHERE thread_id=?')
      .get(threadId)
  }
  /** 保存已核验的文件索引、单元、关系及证据，供读取工具和会话恢复使用。 */
  saveFacts(
    snapshotId: string,
    indexes: FileSemanticIndex[],
    references: CrossFileReference[],
    evidence: Evidence[]
  ) {
    this.db.transaction(() => {
      for (const index of indexes) {
        this.db
          .prepare('INSERT OR REPLACE INTO code_flow_semantic_indexes VALUES(?,?,?)')
          .run(snapshotId, index.fileId, JSON.stringify(FileSemanticIndexSchema.parse(index)))
        for (const unit of index.units)
          this.db
            .prepare('INSERT OR REPLACE INTO code_flow_units VALUES(?,?,?)')
            .run(snapshotId, unit.unitId, JSON.stringify(unit))
      }
      this.db.prepare('DELETE FROM code_flow_references WHERE snapshot_id=?').run(snapshotId)
      for (const ref of references)
        this.db
          .prepare('INSERT OR REPLACE INTO code_flow_references VALUES(?,?,?)')
          .run(snapshotId, ref.referenceId, JSON.stringify(ref))
      for (const item of evidence)
        this.db
          .prepare('INSERT OR REPLACE INTO code_flow_evidence VALUES(?,?,?)')
          .run(snapshotId, item.evidenceId, JSON.stringify(item))
      if (this.hasFts) {
        const row: unknown = this.db
          .prepare('SELECT data FROM code_flow_snapshots WHERE id=?')
          .get(snapshotId)
        const snapshot = SourceSnapshotSchema.parse(JSON.parse(JsonRow.parse(row).data))
        const contents = new Map(
          snapshot.files.map((file) => [file.fileId, this.content(snapshot, file.fileId)])
        )
        for (const chunk of this.chunks(snapshot)) {
          const index = indexes.find((index) => index.fileId === chunk.fileId),
            path = snapshot.files.find((file) => file.fileId === chunk.fileId)!.path
          const text = `${path}\n${contents.get(chunk.fileId)!.slice(chunk.startOffset, chunk.endOffset)}\n${chunkSemanticFields(index, chunk)}`
          this.db
            .prepare('UPDATE code_flow_chunks_fts SET text=? WHERE snapshot_id=? AND chunk_id=?')
            .run(keywordFields(text), snapshotId, chunk.chunkId)
        }
      }
    })()
  }
  indexes(snapshot: SourceSnapshot) {
    const rows: unknown[] = this.db
      .prepare('SELECT data FROM code_flow_semantic_indexes WHERE snapshot_id=?')
      .all(snapshot.snapshotId)
    return rows.map((row) => FileSemanticIndexSchema.parse(JSON.parse(JsonRow.parse(row).data)))
  }
  task(snapshot: SourceSnapshot, id: string, attempts: number, status: string, data: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO code_flow_analysis_tasks VALUES(?,?,?,?,?,?)')
      .run(snapshot.sessionId, snapshot.snapshotId, id, attempts, status, JSON.stringify(data))
  }
  draft(id: string) {
    const row: unknown = this.db
      .prepare('SELECT data FROM code_flow_workspace_drafts WHERE session_id = ?')
      .get(id)
    return row ? DraftSchema.parse(JSON.parse(JsonRow.parse(row).data)) : null
  }
  saveDraft(id: string, input: z.infer<typeof DraftSchema>) {
    const current = this.draft(id)
    if (input.revision !== (current?.revision ?? 0))
      throw new SessionError('草稿版本已变化，请重新加载会话。', 409)
    const next = { ...input, revision: input.revision + 1 }
    this.db
      .prepare('INSERT OR REPLACE INTO code_flow_workspace_drafts VALUES(?,?)')
      .run(id, JSON.stringify(next))
    return next
  }
  /** 清理会话业务数据，再回收没有快照引用的正文和向量等共享记录。 */
  deleteSession(id: string) {
    this.db.transaction(() => {
      const snapshots = this.db
        .prepare('SELECT id FROM code_flow_snapshots WHERE session_id = ?')
        .all(id) as Array<{ id: string }>
      for (const { id: snapshotId } of snapshots) {
        if (this.hasFts)
          this.db.prepare('DELETE FROM code_flow_chunks_fts WHERE snapshot_id = ?').run(snapshotId)
        for (const table of [
          'code_flow_chunks',
          'code_flow_snapshot_files',
          'code_flow_embedding_refs',
          'code_flow_analysis_tasks',
          'code_flow_semantic_indexes',
          'code_flow_units',
          'code_flow_references',
          'code_flow_evidence'
        ])
          this.db.prepare(`DELETE FROM ${table} WHERE snapshot_id = ?`).run(snapshotId)
      }
      for (const table of [
        'code_flow_snapshots',
        'code_flow_workspace_drafts',
        'code_flow_file_indexes',
        'code_flow_multifile_threads'
      ])
        this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id)
      this.db
        .exec(`DELETE FROM code_flow_source_blobs WHERE hash NOT IN (SELECT hash FROM code_flow_snapshot_files);
        DELETE FROM code_flow_source_positions WHERE hash NOT IN (SELECT hash FROM code_flow_source_blobs);
        DELETE FROM code_flow_chunk_templates WHERE hash NOT IN (SELECT hash FROM code_flow_source_blobs);
        DELETE FROM code_flow_embeddings WHERE NOT EXISTS (SELECT 1 FROM code_flow_embedding_refs r WHERE r.input_hash = code_flow_embeddings.input_hash AND r.model = code_flow_embeddings.model);`)
    })()
  }
}
