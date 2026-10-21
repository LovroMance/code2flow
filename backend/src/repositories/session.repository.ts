import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { z } from 'zod'
import { SessionMetadataSchema, type SessionMetadata } from '../domain/session/schema'

const RowSchema = z.object({ data: z.string() })

// 只保存会话目录与编辑草稿；图、映射和消息仍由官方 saver 管理。
export class SessionRepository {
  constructor(private readonly saver: SqliteSaver) {
    saver.db.exec(`CREATE TABLE IF NOT EXISTS code_flow_sessions (
      id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS code_flow_deleted_sessions (id TEXT PRIMARY KEY)`)
  }

  get(id: string) {
    const row: unknown = this.saver.db
      .prepare('SELECT data FROM code_flow_sessions WHERE id = ?')
      .get(id)
    return row ? SessionMetadataSchema.parse(JSON.parse(RowSchema.parse(row).data)) : undefined
  }

  list() {
    const rows: unknown[] = this.saver.db
      .prepare('SELECT data FROM code_flow_sessions ORDER BY updated_at DESC, id')
      .all()
    return rows.map((row) => SessionMetadataSchema.parse(JSON.parse(RowSchema.parse(row).data)))
  }

  save(metadata: SessionMetadata) {
    const data = SessionMetadataSchema.parse(metadata)
    this.saver.db
      .prepare(
        `INSERT INTO code_flow_sessions (id, updated_at, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`
      )
      .run(data.id, data.updatedAt, JSON.stringify(data))
  }

  delete(id: string) {
    // 保留删除标记，防止旧 JSON 兼容导入让已删除会话重新出现。
    this.saver.db
      .prepare('INSERT OR IGNORE INTO code_flow_deleted_sessions (id) VALUES (?)')
      .run(id)
    this.saver.db.prepare('DELETE FROM code_flow_sessions WHERE id = ?').run(id)
  }

  wasDeleted(id: string) {
    return !!this.saver.db.prepare('SELECT id FROM code_flow_deleted_sessions WHERE id = ?').get(id)
  }
}
