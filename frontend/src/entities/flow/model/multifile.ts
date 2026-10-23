import { isSupportedLanguage } from './languages'
import type { FlowGenerationResult, NodeMapping } from './types'

/** 可编辑文件；提交后由后端为不可变快照分配文件身份。 */
export interface SourceFileInput {
  /** 工作区相对路径，重命名会使已有生成结果失效。 */
  path: string
  /** 原始正文，保留换行与 BOM。 */
  content: string
}
/** 快照文件元数据，正文通过文件读取接口按需获取。 */
export interface SnapshotFile {
  /** 当前快照内的文件身份，图节点定位时用它找回路径。 */
  fileId: string
  /** 归一化的相对路径。 */
  path: string
  /** 正文 SHA-256，用于版本标识与后端缓存。 */
  contentHash: string
  /** UTF-8 字节数，与编辑器 UTF-16 字符数不同。 */
  byteSize: number
  /** 原始正文行数。 */
  lineCount: number
}
/** 生成和追问共同绑定的不可变文件集合，与当前编辑草稿分开。 */
export interface SourceSnapshot {
  /** 源码集合身份。 */
  snapshotId: string
  /** 所属用户会话。 */
  sessionId: string
  /** 路径与正文哈希清单摘要，文件顺序和当前选中文件不影响它。 */
  manifestHash: string
  /** 全部成员文件的元数据。 */
  files: SnapshotFile[]
  /** null 表示尚未检测，unknown 表示已检测但不能确定。 */
  languageDetection: { language: FlowGenerationResult['detectedLanguage'] } | null
}
/** 继承单文件行列映射，增加跨文件身份与原始 UTF-16 半开区间。 */
export interface MultiFileMapping extends NodeMapping {
  /** 定位前先用此身份切换到快照对应文件。 */
  fileId: string
  /** 节点所属的执行单元。 */
  unitId: string
  /** 包含起点、不包含终点，与原始字符串 slice 的偏移规则一致。 */
  startOffset: number
  endOffset: number
  /** 支撑节点位置的实际源码读取凭证。 */
  evidenceIds: string[]
}
/** SSE 各事件组装后的 v2 结果，完成运行时校验后才能用于渲染和点击定位。 */
export interface MultiFileResult extends FlowGenerationResult {
  /** 结果协议版本，区别于原有单文件接口。 */
  version: 2
  /** 生成时固定的源码身份。 */
  snapshotId: string
  /** 本次任务身份，同一快照重新生成也有新的 analysisId。 */
  analysisId: string
  /** 纯声明集合可为 false，此时图文本与映射为空。 */
  hasExecutableFlow: boolean
  /** 与最终图节点一一对应的源码位置。 */
  mappings: MultiFileMapping[]
  /** 公开诊断码和说明，如检索降级、未确认关系。 */
  diagnostics: Array<{ code: string; message: string }>
  /** 按原始 UTF-16 范围统计覆盖；不代表能证明所有语义理解正确。 */
  coverage: {
    /** 范围已覆盖且没有阻塞缺口。 */
    complete: boolean
    /** 重叠的分析范围按并集计算，不重复累计。 */
    files: Array<{
      /** 快照文件身份。 */
      fileId: string
      /** 正文 UTF-16 总长度。 */
      total: number
      /** 已分析范围并集的长度。 */
      covered: number
      /** 未覆盖的原始半开区间。 */
      missing: Array<{ startOffset: number; endOffset: number }>
    }>
  }
}
/** 编辑状态独立保存，不能作为旧生成结果的源码版本使用。 */
export interface MultiDraft {
  /** 乐观并发版本，保存时防止较旧请求覆盖新草稿。 */
  revision: number
  /** 当前文件内容集合。 */
  files: SourceFileInput[]
  /** 当前编辑文件，切换它不会改变源码集合。 */
  activePath: string
}
/** 恢复工作区时同时返回编辑草稿和上次分析快照，前端负责判断是否已过期。 */
export interface MultiDetail {
  /** 会话详情协议版本。 */
  version: 2
  /** 最近保存的可编辑状态，首次尚未保存时可为空。 */
  draft: MultiDraft | null
  /** 上次分析绑定的源码快照身份。 */
  sourceSnapshotId: string | null
  /** 上次分析的不可变文件清单。 */
  snapshot: SourceSnapshot | null
  /** 通过校验的生成结果；失败或尚未生成时为空。 */
  result: MultiFileResult | null
  /** 同一分析快照上的用户问题和对外解释。 */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 上次任务是否失败，决定恢复后的错误状态。 */
  failed: boolean
  /** 后端是否仍持有该会话的任务锁。 */
  busy: boolean
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('多文件响应结构无效。')
  return value as Record<string, unknown>
}
function str(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('多文件响应字段无效。')
}
function integer(value: unknown, min = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min)
    throw new Error('多文件响应数值无效。')
}
export function parseSourceFiles(value: unknown): SourceFileInput[] {
  if (!Array.isArray(value)) throw new Error('缺少文件集合。')
  return value.map((item) => {
    const r = record(item)
    str(r.path)
    str(r.content)
    return { path: r.path, content: r.content }
  })
}
export function parseSnapshot(value: unknown): SourceSnapshot {
  const r = record(value)
  for (const field of ['snapshotId', 'sessionId', 'manifestHash']) str(r[field])
  if (!Array.isArray(r.files)) throw new Error('快照文件无效。')
  for (const f of r.files) {
    const file = record(f)
    for (const key of ['fileId', 'path', 'contentHash']) str(file[key])
    integer(file.byteSize)
    integer(file.lineCount, 1)
  }
  if (r.languageDetection !== null && !isSupportedLanguage(record(r.languageDetection).language))
    throw new Error('检测语言无效。')
  return r as unknown as SourceSnapshot
}
/** 跨 HTTP 边界先校验字段、覆盖率和节点对应关系，拒绝把不完整结果标为成功。 */
export function parseMultiResult(value: unknown): MultiFileResult {
  const r = record(value)
  if (
    r.version !== 2 ||
    !isSupportedLanguage(r.detectedLanguage) ||
    typeof r.hasExecutableFlow !== 'boolean'
  )
    throw new Error('多文件结果版本或语言无效。')
  str(r.snapshotId)
  str(r.analysisId)
  str(r.mermaid)
  if (!Array.isArray(r.mappings) || !Array.isArray(r.diagnostics))
    throw new Error('多文件映射无效。')
  const ids = new Set<string>()
  for (const item of r.mappings) {
    const m = record(item)
    for (const key of ['nodeId', 'fileId', 'unitId', 'label', 'description']) str(m[key])
    if (
      !['start', 'action', 'decision', 'return', 'end'].includes(String(m.kind)) ||
      ids.has(String(m.nodeId))
    )
      throw new Error('多文件节点身份无效。')
    ids.add(String(m.nodeId))
    integer(m.startOffset)
    integer(m.endOffset, 1)
    integer(m.lineStart, 1)
    integer(m.lineEnd, 1)
    integer(m.columnStart, 1)
    integer(m.columnEnd, 1)
    if (
      Number(m.endOffset) <= Number(m.startOffset) ||
      Number(m.lineEnd) < Number(m.lineStart) ||
      (Number(m.lineEnd) === Number(m.lineStart) && Number(m.columnEnd) < Number(m.columnStart)) ||
      !Array.isArray(m.evidenceIds) ||
      !m.evidenceIds.length ||
      !m.evidenceIds.every((e) => typeof e === 'string')
    )
      throw new Error('节点范围或证据无效。')
  }
  r.diagnostics.forEach((item) => {
    const d = record(item)
    str(d.code)
    str(d.message)
  })
  const coverage = record(r.coverage)
  if (coverage.complete !== true || !Array.isArray(coverage.files))
    throw new Error('分析未完整覆盖源码。')
  if (
    coverage.unresolvedRanges !== undefined &&
    (!Array.isArray(coverage.unresolvedRanges) || coverage.unresolvedRanges.length)
  )
    throw new Error('存在未确认的执行单元边界。')
  for (const value of coverage.files) {
    const file = record(value)
    str(file.fileId)
    integer(file.total)
    integer(file.covered)
    if (file.total !== file.covered || !Array.isArray(file.missing) || file.missing.length)
      throw new Error('存在未完成的源码范围。')
  }
  const coveredFiles = new Set(coverage.files.map((value) => String(record(value).fileId)))
  if (r.mappings.some((value) => !coveredFiles.has(String(record(value).fileId))))
    throw new Error('映射文件没有进入覆盖记录。')
  if (r.hasExecutableFlow ? !r.mappings.length || !r.mermaid : !!r.mappings.length || !!r.mermaid)
    throw new Error('执行流程状态无效。')
  const result = r as unknown as MultiFileResult
  if (result.hasExecutableFlow) validateControlledGraph(result)
  return result
}
// v2受控序列化协议检查；之后仍必须交给真实Mermaid解析器验证语法与渲染。
function validateControlledGraph(result: MultiFileResult) {
  const mappings = new Map(result.mappings.map((mapping) => [mapping.nodeId, mapping])),
    declared = new Set<string>()
  const lines = result.mermaid.split(/\r?\n/)
  if (lines[0] !== 'flowchart TD') throw new Error('流程图头部无效。')
  for (const line of lines.slice(1)) {
    if (line === 'end' || /^subgraph g_\d+\["[^"\n]*"\]$/.test(line)) continue
    const node = /^(n_\w+)(?:\(\["([^"\n]*)"\]\)|\["([^"\n]*)"\]|\{"([^"\n]*)"\})$/.exec(line)
    if (node) {
      const mapping = mappings.get(node[1]!),
        label = (node[2] ?? node[3] ?? node[4]!).replace(/#(\d+);/g, (_, code: string) =>
          String.fromCodePoint(Number(code))
        )
      if (
        !mapping ||
        declared.has(node[1]!) ||
        mapping.label !== label ||
        !mapping.nodeId.startsWith(`n_${mapping.kind}_${mapping.lineStart}_`)
      )
        throw new Error('节点与映射或标签不一致。')
      declared.add(node[1]!)
      continue
    }
    const edge = /^(n_\w+) (?:-->|-\.->)(?:\|"[^"\n]*"\|)? (n_\w+)$/.exec(line)
    if (!edge || !mappings.has(edge[1]!) || !mappings.has(edge[2]!))
      throw new Error('流程图包含未映射节点、未知边或不受控指令。')
  }
  if (declared.size !== mappings.size) throw new Error('节点与映射没有双向覆盖。')
}
export function parseDraft(value: unknown): MultiDraft {
  const r = record(value)
  integer(r.revision)
  str(r.activePath)
  const files = parseSourceFiles(r.files)
  if (files.length ? !files.some((f) => f.path === r.activePath) : r.activePath !== '')
    throw new Error('活动文件不存在，空工作区的活动路径必须为空。')
  return { revision: r.revision, activePath: r.activePath, files }
}
/** 恢复历史会话时再次核对结果与快照成员，防止错误源码参与定位和追问。 */
export function parseMultiDetail(value: unknown): MultiDetail {
  const r = record(value)
  if (
    r.version !== 2 ||
    typeof r.failed !== 'boolean' ||
    typeof r.busy !== 'boolean' ||
    !Array.isArray(r.messages)
  )
    throw new Error('会话版本无效。')
  const draft = r.draft === null ? null : parseDraft(r.draft),
    snapshot = r.snapshot === null ? null : parseSnapshot(r.snapshot),
    result = r.result === null ? null : parseMultiResult(r.result)
  if (
    result &&
    (!snapshot ||
      result.snapshotId !== snapshot.snapshotId ||
      r.sourceSnapshotId !== snapshot.snapshotId ||
      result.mappings.some(
        (mapping) => !snapshot.files.some((file) => file.fileId === mapping.fileId)
      ))
  )
    throw new Error('结果与源码快照不一致。')
  if (r.sourceSnapshotId !== null) str(r.sourceSnapshotId)
  for (const message of r.messages) {
    const m = record(message)
    if (m.role !== 'user' && m.role !== 'assistant') throw new Error('问答角色无效。')
    str(m.content)
  }
  return { ...r, draft, snapshot, result } as unknown as MultiDetail
}
