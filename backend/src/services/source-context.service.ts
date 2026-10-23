import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { SourceRepository } from '../repositories/source.repository'
import type { SourceSnapshot, Evidence, SourceRange, CodeChunk } from '../domain/source/schema'
import type { FileSemanticIndex } from '../domain/multifile/schema'
import {
  lineOffsets,
  safeBoundary,
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
/** 按块、执行单元或原始行列选取源码；一次读取还受总行数和字符预算限制。 */
const ReadSchema = z.object({
  // 最多 8 个选择器，range 的结束列排他，chunk/unit 必须属于当前快照。
  selectors: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('chunk'), chunkId: z.string() }),
        z.object({ type: z.literal('unit'), unitId: z.string() }),
        z.object({
          type: z.literal('range'),
          fileId: z.string(),
          range: z.object({
            lineStart: z.number().int().positive(),
            lineEnd: z.number().int().positive(),
            columnStart: z.number().int().positive(),
            columnEnd: z.number().int().positive()
          })
        })
      ])
    )
    .min(1)
    .max(8)
})

// 每个角色有独立证据可见域；缓存命中也通过此服务重新登记证据。
export class SourceContext {
  // 索引 Worker 独享上下文，仅用于串联诊断日志，不包含源码和请求参数。
  logContext: { analysisId?: string; taskId?: string; attempt?: number } = {}
  readonly evidence = new Map<string, Evidence>()
  readonly accessible = new Set<string>()
  charsRead = 0
  readCalls = 0
  allowedFileId?: string
  constructor(
    readonly repository: SourceRepository,
    readonly snapshot: SourceSnapshot,
    readonly chunks: CodeChunk[],
    readonly indexes: FileSemanticIndex[] = [],
    readonly signal?: AbortSignal,
    readonly retrieval?: RetrievalService
  ) {}
  /** 读取正文并登记证据，同时统计实际读取量；不接受任意磁盘路径。 */
  read(fileId: string, start: number, end: number) {
    this.signal?.throwIfAborted()
    if (this.allowedFileId && fileId !== this.allowedFileId)
      throw new Error('文件Worker只能读取本文件。')
    const content = this.repository.content(this.snapshot, fileId),
      range = sourceRange(
        fileId,
        content,
        start,
        end,
        this.repository.offsets(this.snapshot, fileId)
      )
    const evidence: Evidence = {
      ...range,
      evidenceId: randomUUID(),
      snapshotId: this.snapshot.snapshotId,
      contentHash: this.snapshot.files.find((f) => f.fileId === fileId)!.contentHash
    }
    this.evidence.set(evidence.evidenceId, evidence)
    this.accessible.add(evidence.evidenceId)
    this.charsRead += end - start
    this.readCalls++
    // 保留原始 CRLF/UTF-16 坐标，避免模型从展示正文重新计数而使行列与偏移冲突。
    const offsets = this.repository.offsets(this.snapshot, fileId)
    const linePositions = offsets.flatMap((lineStart, index) => {
      if (lineStart >= end || (offsets[index + 1] ?? content.length) <= start) return []
      let lineEnd = offsets[index + 1] ?? content.length
      while (lineEnd > lineStart && /[\r\n]/.test(content[lineEnd - 1]!)) lineEnd--
      const visibleStart = Math.max(start, lineStart)
      const visibleEnd = Math.min(end, lineEnd)
      if (visibleEnd < visibleStart) return []
      return [
        {
          line: index + 1,
          startOffset: visibleStart,
          endOffset: visibleEnd,
          columnStart: visibleStart - lineStart + 1,
          columnEnd: visibleEnd - lineStart + 1
        }
      ]
    })
    return {
      content: content.slice(start, end),
      linePositions,
      evidence,
      truncated: false,
      metering: {
        chars: end - start,
        lines:
          range.lineEnd -
          range.lineStart +
          1 -
          (range.columnEnd === 1 && range.lineEnd > range.lineStart ? 1 : 0)
      }
    }
  }
  /** 先校验原始行列，再检查当前角色可见的证据并集是否完整覆盖目标范围。 */
  validate(range: SourceRange, evidenceIds: string[]) {
    const content = this.repository.content(this.snapshot, range.fileId)
    try {
      validateSourceRange(range, range.fileId, content)
    } catch (error) {
      // 不自动改写模型范围；给重试提供由原始偏移计算的正确行列，仍须重新通过校验。
      if (
        range.startOffset >= 0 &&
        range.endOffset > range.startOffset &&
        range.endOffset <= content.length
      ) {
        const expected = sourceRange(range.fileId, content, range.startOffset, range.endOffset)
        throw new Error(
          `源码范围校验失败：提交行列${range.lineStart}:${range.columnStart}-${range.lineEnd}:${range.columnEnd}与偏移[${range.startOffset},${range.endOffset})不一致，偏移实际对应${expected.lineStart}:${expected.columnStart}-${expected.lineEnd}:${expected.columnEnd}；请直接使用linePositions的原始坐标。`
        )
      }
      throw error
    }
    if (!evidenceIds.length || evidenceIds.some((id) => !this.accessible.has(id)))
      throw new Error('引用了任务不可访问的证据。')
    const ranges = evidenceIds
      .map((id) => this.evidence.get(id)!)
      .filter((e) => e.fileId === range.fileId)
      .sort((a, b) => a.startOffset - b.startOffset)
    let cursor = range.startOffset
    for (const evidence of ranges)
      if (evidence.startOffset <= cursor) cursor = Math.max(cursor, evidence.endOffset)
    if (cursor < range.endOffset) throw new Error('源码范围没有完整证据。')
  }
  /** 索引角色只获 read_code；核对和追问角色额外获得目录、索引与检索工具。 */
  tools(role: 'index' | 'verify' | 'followup' = 'verify') {
    const read = tool(
      async (input) => {
        this.signal?.throwIfAborted()
        let chars = SOURCE_LIMITS.readChars,
          lines = SOURCE_LIMITS.readLines
        const data = input.selectors.map((selector) => {
          let fileId: string, start: number, end: number
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
            const content = this.repository.content(this.snapshot, fileId),
              offsets = lineOffsets(content)
            start = (offsets[selector.range.lineStart - 1] ?? -1) + selector.range.columnStart - 1
            end = (offsets[selector.range.lineEnd - 1] ?? -1) + selector.range.columnEnd - 1
            validateSourceRange(
              { ...selector.range, fileId, startOffset: start, endOffset: end },
              fileId,
              content
            )
          }
          if (chars <= 0 || lines <= 0)
            return {
              fileId,
              truncated: true,
              nextRange: sourceRange(
                fileId,
                this.repository.content(this.snapshot, fileId),
                start,
                end
              ),
              metering: { chars: 0, lines: 0 }
            }
          const content = this.repository.content(this.snapshot, fileId),
            offsets = lineOffsets(content),
            original = sourceRange(fileId, content, start, end)
          const actualEnd = safeBoundary(
            content,
            Math.min(end, start + chars, offsets[original.lineStart - 1 + lines] ?? content.length)
          )
          if (actualEnd <= start) throw new Error('读取预算不足。')
          const result = this.read(fileId, start, actualEnd)
          chars -= result.metering.chars
          lines -= result.metering.lines
          return {
            ...result,
            truncated: actualEnd < end,
            ...(actualEnd < end ? { nextRange: sourceRange(fileId, content, actualEnd, end) } : {})
          }
        })
        return {
          data,
          truncated: data.some((item) => item.truncated),
          metering: {
            chars: SOURCE_LIMITS.readChars - chars,
            lines: SOURCE_LIMITS.readLines - lines
          }
        }
      },
      {
        name: 'read_code',
        description:
          '只读当前快照。每次最多8个块/单元/原始行列范围，共200行、12000个UTF-16字符。终点列排他。截断返回实际证据和nextRange，须继续读；零读取不产生证据。',
        schema: ReadSchema
      }
    )
    if (role === 'index') return [read]
    return [
      read,
      tool(
        async (input) => {
          const page = PageSchema.parse(input),
            cursor = page.cursor ?? 0
          if (cursor > this.snapshot.files.length) throw new Error('目录游标无效。')
          const data = this.snapshot.files
            .slice(cursor, cursor + (page.limit ?? 20))
            .map((file) => ({
              ...file,
              language: this.snapshot.languageDetection?.language ?? 'unknown',
              status: this.indexes.find((i) => i.fileId === file.fileId)?.status ?? 'pending'
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
            data,
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
          return this.retrieval.search(input.query, input.mode, input.fileIds, input.limit)
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
