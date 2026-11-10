import { ModelOutputValidationError } from '../domain/multifile/errors'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { SourceRepository } from '../repositories/source.repository'
import type { SourceSnapshot, Evidence, SourceRange, CodeChunk } from '../domain/source/schema'
import type { FileSemanticIndex } from '../domain/multifile/schema'
import { SourceLineRangeSchema } from '../domain/source/schema'
import { slimModelInput } from '../ai/chains/multifile-output'
import {
  coveredLines,
  sha256,
  sourceLineRange,
  sourceRange,
  validateSourceRange
} from '../utils/sourcePositions'
import { SOURCE_LIMITS } from './multifile-config'
import type { RetrievalService } from './retrieval.service'

/** 文件和索引工具的分页参数；限制单页大小，避免工具返回挤满上下文。 */
const PageSchema = z.object({
  // 从第几条开始读取，不是数据库游标令牌。
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).optional()
})
/** 按块、执行单元或原始行号选取源码。 */
const ReadSchema = z.object({
  selectors: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('chunk'), chunkId: z.string() }),
        z.object({ type: z.literal('unit'), unitId: z.string() }),
        z.object({
          type: z.literal('range'),
          fileId: z.string(),
          range: SourceLineRangeSchema
        })
      ])
    )
    .min(1)
    .max(8)
})

// 每个角色有独立证据可见域；缓存命中也通过此服务重新登记证据。
export class SourceContext {
  readonly evidence = new Map<string, Evidence>()
  readonly accessible = new Set<string>()
  allowedFileId?: string
  constructor(
    readonly repository: SourceRepository,
    readonly snapshot: SourceSnapshot,
    readonly chunks: CodeChunk[],
    readonly indexes: FileSemanticIndex[] = [],
    readonly signal?: AbortSignal,
    readonly retrieval?: RetrievalService
  ) {}
  /** 读取正文并登记证据，返回本次读取的字符和行数以限制工具输出。 */
  read(fileId: string, start: number, end: number) {
    this.signal?.throwIfAborted()
    if (this.allowedFileId && fileId !== this.allowedFileId)
      throw new Error('文件分析任务只能读取本文件。')
    const content = this.repository.content(this.snapshot, fileId),
      offsets = this.repository.offsets(this.snapshot, fileId),
      range = sourceRange(fileId, content, start, end, offsets),
      { lineStart, lineEnd } = coveredLines(range)
    // 证据ID由快照与范围决定：同范围重复读取收敛到同一凭证，跨任务合并天然去重。
    const evidence: Evidence = {
      ...range,
      evidenceId: `e${sha256(`${this.snapshot.snapshotId}|${fileId}|${start}|${end}`).slice(0, 12)}`,
      snapshotId: this.snapshot.snapshotId,
      contentHash: this.snapshot.files.find((f) => f.fileId === fileId)!.contentHash
    }
    this.evidence.set(evidence.evidenceId, evidence)
    this.accessible.add(evidence.evidenceId)
    // 展示正文带原始行号前缀，模型直接引用行号，避免自行计数导致行列与偏移冲突。
    const lines: string[] = []
    for (let line = lineStart; line <= lineEnd; line++) {
      const startOfLine = offsets[line - 1]!
      const endOfLine = offsets[line] ?? content.length
      lines.push(`${line}| ${content.slice(startOfLine, endOfLine).replace(/[\r\n]+$/, '')}`)
    }
    return {
      content: lines.join('\n'),
      evidence,
      truncated: false,
      metering: {
        chars: end - start,
        lines: lineEnd - lineStart + 1
      }
    }
  }
  /** 校验内部范围的偏移和行列是否与当前源码一致。 */
  validateRange(range: SourceRange) {
    const content = this.repository.content(this.snapshot, range.fileId)
    try {
      validateSourceRange(range, range.fileId, content)
    } catch (error) {
      if (!(error instanceof Error) || error.constructor !== Error) throw error
      throw new ModelOutputValidationError('源码范围校验失败，请对照源码前缀提交起止行号。')
    }
  }
  /** 先校验原始行列，再检查当前角色可见的证据并集是否完整覆盖目标范围。 */
  validate(range: SourceRange, evidenceIds: string[]) {
    this.validateRange(range)
    if (!evidenceIds.length || evidenceIds.some((id) => !this.accessible.has(id)))
      throw new ModelOutputValidationError('引用了任务不可访问的证据。')
    const ranges = evidenceIds
      .map((id) => this.evidence.get(id)!)
      .filter((e) => e.fileId === range.fileId)
      .sort((a, b) => a.startOffset - b.startOffset)
    let cursor = range.startOffset
    for (const evidence of ranges)
      if (evidence.startOffset <= cursor) cursor = Math.max(cursor, evidence.endOffset)
    if (cursor < range.endOffset) throw new ModelOutputValidationError('源码范围没有完整证据。')
  }
  /** 追问角色可以读取额外源码和检索候选。 */
  tools() {
    const read = tool(
      async (input) => {
        this.signal?.throwIfAborted()
        let chars = SOURCE_LIMITS.readChars,
          lines = SOURCE_LIMITS.readLines
        const data = input.selectors.map((selector) => {
          let fileId: string, start: number, end: number
          try {
            if (selector.type === 'chunk') {
              const chunk = this.chunks.find((c) => c.chunkId === selector.chunkId)
              if (!chunk) throw new Error('未知代码块。')
              fileId = chunk.fileId
              start = chunk.startOffset
              end = chunk.endOffset
            } else if (selector.type === 'unit') {
              const unit = this.indexes
                .flatMap((i) => i.units)
                .find((u) => u.unitId === selector.unitId)
              if (!unit) throw new Error('未知执行单元。')
              fileId = unit.range.fileId
              start = unit.range.startOffset
              end = unit.range.endOffset
            } else {
              fileId = selector.fileId
              const range = sourceLineRange(
                fileId,
                this.repository.content(this.snapshot, fileId),
                selector.range.lineStart,
                selector.range.lineEnd,
                this.repository.offsets(this.snapshot, fileId)
              )
              start = range.startOffset
              end = range.endOffset
            }
            if (this.allowedFileId && this.allowedFileId !== fileId)
              throw new Error('文件分析任务只能读取本文件。')
          } catch (error) {
            // 模型给出的范围参数无效时作为工具反馈返回，允许其在剩余轮次内自行纠正；
            // 取消信号不属于参数错误，仍然向上抛出。
            if (this.signal?.aborted) throw error
            return {
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : '读取参数无效，请检查选择器。'
            }
          }
          const content = this.repository.content(this.snapshot, fileId),
            offsets = this.repository.offsets(this.snapshot, fileId),
            original = coveredLines(sourceRange(fileId, content, start, end, offsets))
          const fullStart = offsets[original.lineStart - 1]!
          const endLine = Math.min(original.lineEnd, original.lineStart + lines - 1)
          let lastReadLine = original.lineStart - 1
          let actualEnd = fullStart
          for (let line = original.lineStart; line <= endLine; line++) {
            const next = offsets[line] ?? content.length
            if (next - fullStart > chars) break
            lastReadLine = line
            actualEnd = next
          }
          const truncated = lastReadLine < original.lineEnd
          const continuation = truncated
            ? { nextRange: { fileId, lineStart: lastReadLine + 1, lineEnd: original.lineEnd } }
            : {}
          if (actualEnd === fullStart)
            return {
              fileId,
              error: `剩余读取预算不足以读取第 ${original.lineStart} 行的完整内容。`,
              truncated,
              ...continuation
            }
          const result = this.read(fileId, fullStart, actualEnd)
          chars -= result.metering.chars
          lines -= result.metering.lines
          return {
            content: result.content,
            evidence: slimModelInput(result.evidence),
            metering: result.metering,
            truncated,
            ...continuation
          }
        })
        return {
          data,
          truncated: data.some((item) => 'truncated' in item && item.truncated),
          metering: {
            chars: SOURCE_LIMITS.readChars - chars,
            lines: SOURCE_LIMITS.readLines - lines
          }
        }
      },
      {
        name: 'read_code',
        description:
          '只读当前快照。每次最多8个块/单元/原始行范围，共200行、12000个UTF-16字符。首尾行都包含。只返回完整行。截断时返回实际证据和nextRange；零读取不产生证据。',
        schema: ReadSchema
      }
    )
    return [
      read,
      tool(
        async (input) => {
          const page = PageSchema.parse(input),
            cursor = page.cursor ?? 0
          if (cursor > this.snapshot.files.length) throw new Error('目录游标无效。')
          const data = this.snapshot.files
            .slice(cursor, cursor + (page.limit ?? 20))
            .map(({ fileId, path }) => ({
              fileId,
              path,
              language: this.snapshot.languageDetection?.language ?? 'unknown',
              status: this.indexes.find((i) => i.fileId === fileId)?.status ?? 'pending'
            }))
          return {
            data,
            truncated: cursor + data.length < this.snapshot.files.length,
            nextCursor: cursor + data.length,
            evidence: [],
            metering: { chars: 0 }
          }
        },
        {
          name: 'list_files',
          description: '当前快照文件目录，不含正文；默认及最多20项，cursor为零起始整数下标。',
          schema: PageSchema
        }
      ),
      tool(
        async (input) => {
          input.fileIds.forEach((id) => this.repository.content(this.snapshot, id))
          const indexes = this.indexes.filter((i) => input.fileIds.includes(i.fileId))
          const all: unknown[] =
            input.sections?.includes('details') || input.unitIds?.length
              ? indexes.flatMap((index) => [
                  ...index.units
                    .filter((u) => !input.unitIds?.length || input.unitIds.includes(u.unitId))
                    .map((unit) => ({ section: 'unit', fileId: index.fileId, unit })),
                  ...(!input.unitIds?.length
                    ? index.references.map((reference) => ({
                        section: 'reference',
                        fileId: index.fileId,
                        reference
                      }))
                    : [])
                ])
              : indexes.map((index) => ({
                  fileId: index.fileId,
                  summary: index.summary,
                  status: index.status,
                  unitCount: index.units.length
                }))
          const cursor = input.cursor ?? 0
          if (cursor > all.length) throw new Error('索引游标无效。')
          const data = all.slice(cursor, cursor + 20)
          return {
            data: slimModelInput(data),
            truncated: cursor + data.length < all.length,
            nextCursor: cursor + data.length,
            evidence: [],
            metering: { chars: 0 }
          }
        },
        {
          name: 'get_file_index',
          description:
            '读取当前快照语义索引，默认简要概览与单元数；sections包含details或指定unitIds时分页返回单元/引用事实。每页最多20项，cursor为整数下标。',
          schema: z.object({
            fileIds: z.array(z.string()).min(1).max(20),
            unitIds: z.array(z.string()).max(100).optional(),
            sections: z.array(z.enum(['overview', 'details'])).optional(),
            cursor: z.number().int().nonnegative().optional()
          })
        }
      ),
      tool(
        async (input) => {
          if (!this.retrieval) throw new Error('检索尚未准备。')
          return slimModelInput(
            await this.retrieval.search(input.query, input.mode, input.fileIds, input.limit)
          )
        },
        {
          name: 'search_code',
          description:
            '仅当前快照候选召回。精确/关键词/语义/混合检索，默认8项、最多20项，每项片段不超过400字符。相似度不是调用证据，必须read_code核对。',
          schema: z.object({
            query: z.string().min(1).max(500),
            mode: z.enum(['exact', 'keyword', 'semantic', 'hybrid']),
            fileIds: z.array(z.string()).max(20).optional(),
            limit: z.number().int().min(1).max(20).default(8)
          })
        }
      )
    ]
  }
}
