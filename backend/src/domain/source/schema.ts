import { z } from 'zod'
import { LanguageDetectionSchema } from '../flow/schema'

/** 原始字符串的 UTF-16 半开区间 [startOffset, endOffset)，与 JS 字符串切片一致。 */
export const OffsetRangeSchema = z.object({
  // 包含的起始字符偏移，从 0 开始。
  startOffset: z.number().int().nonnegative(),
  // 不包含的结束字符偏移；不是 UTF-8 字节数。
  endOffset: z.number().int().nonnegative()
})
/** 偏移和行列同时指向原始正文；行列从 1 开始，结束位置排他。 */
export const SourceRangeSchema = OffsetRangeSchema.extend({
  // 当前快照中的文件身份，不能用路径或模型临时编号代替。
  fileId: z.string().min(1),
  // 起点、终点所在的原始源码行。
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  // UTF-16 列位置；columnEnd 不包含在范围内。
  columnStart: z.number().int().positive(),
  columnEnd: z.number().int().positive()
})
/** 客户端提交的文件；正式 fileId 与哈希由后端创建快照时生成。 */
export const SourceFileInputSchema = z.object({
  // 工作区内的相对路径，用于文件展示和导入关系解析。
  path: z.string().min(1).max(500),
  // 未经行号标注、裁剪或换行转换的原始正文。
  content: z.string().min(1)
})
// 此处是协议上限；实际文件数量和总字节数还受运行配置限制。
export const SourceFilesSchema = z.array(SourceFileInputSchema).min(1).max(1000)
/** 快照文件清单只保存元数据，正文按 contentHash 从仓储读取。 */
export const SnapshotFileSchema = z.object({
  // 当前快照内的文件标识，供范围、索引和前端定位引用。
  fileId: z.string(),
  // 归一化的工作区相对路径。
  path: z.string(),
  // 原始正文的 SHA-256，关联正文存储与缓存。
  contentHash: z.string(),
  // UTF-8 编码字节数，用于上传体积限制。
  byteSize: z.number().int(),
  // 原始正文行数，用于范围校验。
  lineCount: z.number().int()
})
/** 一次分析绑定的不可变源码集合；编辑草稿不会改写该集合。 */
export const SourceSnapshotSchema = z.object({
  // 快照身份，生成和追问都必须显式绑定。
  snapshotId: z.string(),
  // 所属用户会话，用于隔离读取、缓存和删除范围。
  sessionId: z.string(),
  // 路径与正文哈希清单的摘要；重命名也会影响它。
  manifestHash: z.string(),
  // 本快照全部文件的元数据，不携带正文。
  files: z.array(SnapshotFileSchema),
  // null 表示尚未检测；检测得到 unknown 也是可复用的结果。
  languageDetection: LanguageDetectionSchema.nullable()
})
/** 保留原始位置的基础切片；相邻块可重叠，不代表完整语义单元。 */
export const CodeChunkSchema = SourceRangeSchema.extend({
  // 分块任务身份，用于调度与任务记录。
  chunkId: z.string(),
  // 所属文件正文的哈希，不是分块字符串的哈希。
  contentHash: z.string(),
  // 切片算法版本，避免算法变更后误用旧缓存。
  chunkerVersion: z.string()
})
/** 程序实际读取过的源码凭证；模型输出的范围必须有相应证据覆盖。 */
export const EvidenceSchema = SourceRangeSchema.extend({
  // 本次上下文登记的证据身份；缓存复用时需要重新绑定。
  evidenceId: z.string(),
  // 限定证据所属快照，防止旧图与新源码混用。
  snapshotId: z.string(),
  // 绑定所读取文件的正文版本。
  contentHash: z.string()
})
/** 可编辑工作区，与用于生成的不可变快照分开保存。 */
export const DraftSchema = z.object({
  // 乐观并发版本，阻止旧保存请求覆盖较新的草稿。
  revision: z.number().int().nonnegative(),
  // 当前全部文件的路径和正文。
  files: SourceFilesSchema,
  // 当前编辑文件；切换它不改变源码集合身份。
  activePath: z.string().min(1)
})
export type SourceRange = z.infer<typeof SourceRangeSchema>
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>
export type SourceFileInput = z.infer<typeof SourceFileInputSchema>
export type CodeChunk = z.infer<typeof CodeChunkSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
