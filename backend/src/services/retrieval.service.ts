import { OpenAIEmbeddings } from '@langchain/openai'
import { z } from 'zod'
import type { SourceRepository } from '../repositories/source.repository'
import type { SourceSnapshot, CodeChunk } from '../domain/source/schema'
import type { PublicDiagnostic, FileSemanticIndex } from '../domain/multifile/schema'
import { chunkSemanticFields } from '../utils/searchFields'
import { sha256 } from '../utils/sourcePositions'
import { modelPermit, SOURCE_LIMITS } from './multifile-config'

const VectorRow = z.object({ dimension: z.number(), vector: z.instanceof(Buffer) })
let vectorQueue: Promise<void> = Promise.resolve()
function vector(value: number[], dimension?: number) {
  if (
    !value.length ||
    (dimension !== undefined && dimension !== value.length) ||
    !value.every(Number.isFinite) ||
    !value.some((x) => x !== 0)
  )
    throw new Error('向量维度或数值无效。')
  return value
}
/** 在同一向量维度空间计算余弦相似度，分数只用于候选排序，不证明调用关系。 */
export function cosine(a: number[], b: number[]) {
  vector(a, b.length)
  vector(b)
  return (
    a.reduce((n, x, i) => n + x * b[i]!, 0) /
    Math.sqrt(a.reduce((n, x) => n + x * x, 0) * b.reduce((n, x) => n + x * x, 0))
  )
}
/** 用排名倒数融合关键词与向量结果，避免直接比较 BM25 和余弦的不同分值尺度。 */
export function rrf(rankings: string[][]) {
  const scores = new Map<string, number>()
  for (const ranking of rankings)
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1)))
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
/** 当前快照的补充上下文检索；返回候选片段，实际引用仍需 read_code 登记证据。 */
export class RetrievalService {
  readonly diagnostics: PublicDiagnostic[] = []
  readonly vectors = new Map<string, number[]>()
  private readonly semanticFields = new Map<string, string>()
  setIndexes(indexes: FileSemanticIndex[]) {
    for (const chunk of this.chunks)
      this.semanticFields.set(
        chunk.chunkId,
        chunkSemanticFields(
          indexes.find((index) => index.fileId === chunk.fileId),
          chunk
        )
      )
  }
  private embedding?: OpenAIEmbeddings
  private dimension?: number
  private readonly contents = new Map<string, string>()
  private readonly model = process.env.CODE2FLOW_EMBEDDING_MODEL ?? ''
  embeddingCalls = 0
  readonly embeddingUsage = {
    inputTokens: 0,
    totalTokens: 0,
    reportedRequests: 0,
    usageStatus: 'missing' as 'missing' | 'partial' | 'complete'
  }
  constructor(
    private readonly repo: SourceRepository,
    private readonly snapshot: SourceSnapshot,
    private readonly chunks: CodeChunk[],
    private readonly signal: AbortSignal,
    private readonly concurrency = 3
  ) {
    if (!repo.hasFts) this.degrade('fts_unavailable', 'FTS5 不可用，已降级为受限文本匹配。')
    const baseURL = process.env.CODE2FLOW_EMBEDDING_BASE_URL,
      apiKey = process.env.CODE2FLOW_EMBEDDING_API_KEY
    if (baseURL && apiKey && this.model)
      this.embedding = new OpenAIEmbeddings({
        model: this.model,
        apiKey,
        configuration: {
          baseURL,
          fetch: async (url, init) => {
            const response = await fetch(url, {
              ...init,
              signal: AbortSignal.any([this.signal, ...(init?.signal ? [init.signal] : [])])
            })
            if (response.ok) {
              const result = z
                .object({
                  usage: z
                    .object({
                      prompt_tokens: z.number().int().nonnegative(),
                      total_tokens: z.number().int().nonnegative()
                    })
                    .optional()
                })
                .safeParse(await response.clone().json())
              if (result.success && result.data.usage) {
                this.embeddingUsage.inputTokens += result.data.usage.prompt_tokens
                this.embeddingUsage.totalTokens += result.data.usage.total_tokens
                this.embeddingUsage.reportedRequests++
              }
            }
            this.embeddingUsage.usageStatus =
              this.embeddingUsage.reportedRequests === this.embeddingCalls
                ? 'complete'
                : this.embeddingUsage.reportedRequests
                  ? 'partial'
                  : 'missing'
            return response
          }
        },
        maxRetries: 0,
        timeout: 15000,
        batchSize: 16,
        stripNewLines: false
      })
    else this.degrade('embedding_unconfigured', '未配置独立 Embedding 服务，使用关键词检索。')
  }
  private degrade(code: string, message: string) {
    if (!this.diagnostics.some((d) => d.code === code)) this.diagnostics.push({ code, message })
  }
  private text(chunk: CodeChunk) {
    let content = this.contents.get(chunk.fileId)
    if (content === undefined) {
      content = this.repo.content(this.snapshot, chunk.fileId)
      this.contents.set(chunk.fileId, content)
    }
    return `${this.snapshot.files.find((f) => f.fileId === chunk.fileId)!.path}\n${content.slice(chunk.startOffset, chunk.endOffset)}`
  }
  /** 为路径与原始分块正文建立或复用向量；失败只降级检索，不跳过源码分析。 */
  async prepare() {
    if (!this.embedding) return
    if (this.chunks.length > SOURCE_LIMITS.maxVectors) {
      this.degrade('vector_limit', '超过2000个活动块，跳过向量通道；仍分析全部源码。')
      return
    }
    try {
      for (let i = 0; i < this.chunks.length; i += 16) {
        this.signal.throwIfAborted()
        const batch = this.chunks.slice(i, i + 16),
          missing: CodeChunk[] = []
        for (const chunk of batch) {
          const hash = sha256(this.text(chunk))
          this.repo.db
            .prepare('INSERT OR IGNORE INTO code_flow_embedding_refs VALUES(?,?,?)')
            .run(this.snapshot.snapshotId, hash, this.model)
          const raw: unknown = this.repo.db
            .prepare(
              'SELECT dimension,vector FROM code_flow_embeddings WHERE input_hash=? AND model=? AND version=?'
            )
            .get(hash, this.model, 'path-code-v1')
          if (!raw) {
            missing.push(chunk)
            continue
          }
          const row = VectorRow.parse(raw)
          if (row.vector.byteLength !== row.dimension * 4) throw new Error('向量格式错误。')
          const values = Array.from({ length: row.dimension }, (_, n) =>
            row.vector.readFloatLE(n * 4)
          )
          vector(values, this.dimension)
          this.dimension = values.length
          this.vectors.set(chunk.chunkId, values)
        }
        if (!missing.length) continue
        this.embeddingCalls++
        const results = await modelPermit(this.concurrency, this.signal, () =>
          this.embedding!.embedDocuments(missing.map((c) => this.text(c)))
        )
        if (results.length !== missing.length) throw new Error('向量批量数量不匹配。')
        results.forEach((values, n) => {
          vector(values, this.dimension)
          this.dimension = values.length
          const blob = Buffer.alloc(values.length * 4)
          values.forEach((v, k) => blob.writeFloatLE(v, k * 4))
          this.repo.db
            .prepare('INSERT OR REPLACE INTO code_flow_embeddings VALUES(?,?,?,?,?)')
            .run(sha256(this.text(missing[n]!)), this.model, values.length, 'path-code-v1', blob)
          this.vectors.set(missing[n]!.chunkId, values)
        })
      }
    } catch {
      this.signal.throwIfAborted()
      this.vectors.clear()
      this.degrade('embedding_failed', 'Embedding 请求失败或向量空间不一致，已降级为关键词检索。')
    }
  }
  /** 合并精确、关键词及可用的向量通道，限制返回条数与片段长度。 */
  async search(query: string, mode: string, fileIds?: string[], limit = 8) {
    this.signal.throwIfAborted()
    fileIds?.forEach((id) => this.repo.content(this.snapshot, id))
    const candidates = this.chunks.filter((c) => !fileIds?.length || fileIds.includes(c.fileId)),
      allowed = new Set(candidates.map((c) => c.chunkId))
    const exact = candidates
      .filter((c) => this.text(c).toLowerCase().includes(query.toLowerCase()))
      .map((c) => c.chunkId)
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
    const substring = candidates
      .filter((c) =>
        terms.some((term) =>
          `${this.text(c)}\n${this.semanticFields.get(c.chunkId) ?? ''}`
            .toLowerCase()
            .includes(term)
        )
      )
      .map((c) => c.chunkId)
    let keyword: string[] = [],
      semantic: string[] = []
    if (mode !== 'exact' && this.repo.hasFts) {
      const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? []
      if (terms.length) {
        const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ')
        const rows = this.repo.db
          .prepare(
            'SELECT chunk_id FROM code_flow_chunks_fts WHERE code_flow_chunks_fts MATCH ? AND snapshot_id=? ORDER BY bm25(code_flow_chunks_fts) ASC'
          )
          .all(match, this.snapshot.snapshotId) as Array<{ chunk_id: string }>
        keyword = rows
          .map((r) => r.chunk_id)
          .filter((id) => allowed.has(id))
          .slice(0, 20)
      }
    }
    if ((mode === 'semantic' || mode === 'hybrid') && this.embedding && this.vectors.size) {
      try {
        this.embeddingCalls++
        const q = await modelPermit(this.concurrency, this.signal, () =>
          this.embedding!.embedQuery(query)
        )
        vector(q, this.dimension)
        // 全进程一次只计算一个精确向量查询，每100块让出事件循环。
        const calculation = vectorQueue.then(async () => {
          this.signal.throwIfAborted()
          const scores: Array<[string, number]> = []
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i]!
            const v = this.vectors.get(c.chunkId)
            if (v) scores.push([c.chunkId, cosine(q, v)])
            if (i % 100 === 99) await new Promise<void>((resolve) => setImmediate(resolve))
            this.signal.throwIfAborted()
          }
          return scores
        })
        vectorQueue = calculation.then(
          () => {},
          () => {}
        )
        const scores = await calculation
        semantic = scores
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([id]) => id)
      } catch {
        this.signal.throwIfAborted()
        this.degrade('embedding_query_failed', '语义查询失败，使用关键词召回。')
      }
    }
    const ranking = [
        ...new Set([...exact, ...rrf([keyword, semantic]), ...(mode === 'exact' ? [] : substring)])
      ],
      selected = ranking.slice(0, limit)
    return {
      data: selected.map((id, rank) => {
        const chunk = candidates.find((c) => c.chunkId === id)!
        return {
          ...chunk,
          rank: rank + 1,
          snippet: this.text(chunk).slice(0, 400),
          sources: [
            ...(exact.includes(id) ? ['exact'] : []),
            ...(keyword.includes(id) ? ['keyword'] : []),
            ...(semantic.includes(id) ? ['semantic'] : []),
            ...(substring.includes(id) ? ['substring'] : [])
          ]
        }
      }),
      truncated: ranking.length > limit,
      evidence: [],
      metering: { chars: selected.length * 400 },
      diagnostics: this.diagnostics
    }
  }
}
