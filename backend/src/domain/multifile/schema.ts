import { z } from 'zod'
import { NodeKindSchema } from '../flow/schema'
import { SupportedLanguageSchema } from '../flow/language'
import { OffsetRangeSchema, SourceRangeSchema } from '../source/schema'

const text = z.string().max(1000)
const ids = z.array(z.string().min(1)).max(100)
/** 单元内的调用或注册位置；先登记线索，再核对目标，不凭同名直接连边。 */
export const CallSiteSchema = z.object({
  // 索引阶段为临时身份，合并后由程序重建正式身份。
  callSiteId: z.string(),
  // 普通调用、事件等注册、跨服务请求需要分别解释。
  kind: z.enum(['call', 'registration', 'request']),
  // 调用范围内逐字出现的源码片段，不使用释义或改写后的代码。
  text,
  // 调用语句在原始文件中的位置。
  range: SourceRangeSchema,
  // 待解析目标名或路径线索，不表示目标已确认。
  targetHint: text,
  // 成员调用的接收者，如 service.save 中的 service。
  receiver: text.optional(),
  // 支撑该调用位置的实际读取凭证。
  evidenceIds: ids
})
/** 可独立生成局部流程的语义单元；长单元可能先以多个不完整片段出现。 */
export const ExecutionUnitSchema = z.object({
  // Worker 提交临时 ID，合并后由程序分配正式 unitId。
  unitId: z.string(),
  // 单元名称；匿名入口也应描述其用途。
  name: text,
  // 所属类、函数、包或命名空间，用于区分同名单元。
  scope: text,
  // 区分可执行入口和纯声明，纯声明允许不生成节点。
  kind: z.enum([
    'function',
    'method',
    'top-level',
    'event',
    'lifecycle',
    'reactive',
    'declaration',
    'other'
  ]),
  // 完整单元或当前已读片段在原始正文中的范围。
  range: SourceRangeSchema,
  // 用于识别重叠片段是否属于同一个单元的签名线索。
  signature: text,
  // 单元职责摘要，不保存模型内部推理。
  summary: text,
  // 关键控制语句位置，用于检查局部流程是否遗漏分支等结构。
  controlRanges: z
    .array(
      z.object({
        kind: z.enum(['branch', 'loop', 'exception', 'return']),
        range: SourceRangeSchema
      })
    )
    .max(500),
  // 当前单元直接包含的调用点，不重复登记嵌套单元内部的调用。
  callSites: z.array(CallSiteSchema).max(500),
  // 支撑该单元及边界的实际读取凭证。
  evidenceIds: ids,
  // 是否真正读到单元起止边界；块的起止不等于函数起止。
  boundary: z.object({ startKnown: z.boolean(), endKnown: z.boolean() }),
  // 只有两侧边界均确认时才可完整，合并时仍会交叉校验。
  complete: z.boolean()
})
/** 文件中的导入、导出及作用域线索，本身不等于执行调用边。 */
export const ReferenceIndexSchema = z.object({
  // scope 表示源码显式声明的包或命名空间。
  kind: z.enum(['import', 'export', 'registration', 'request', 'scope']),
  // 被导入、导出或声明的原名。
  name: text,
  // 本文件中的别名，无别名时由角色按契约填写。
  alias: text,
  // 源码中的目标路径或模块路径线索。
  targetPath: text,
  // 线索语句的位置及其读取凭证。
  range: SourceRangeSchema,
  evidenceIds: ids
})
/** 单块 Worker 输出与文件合并索引共用的结构，不包含最终 Mermaid。 */
export const FileSemanticIndexSchema = z.object({
  // 索引只属于一个快照文件。
  fileId: z.string(),
  // 文件职责摘要，供检索和关系核对使用。
  summary: text,
  // 识别到的单元或待合并片段。
  units: z.array(ExecutionUnitSchema).max(1000),
  // 导入、导出、注册等结构线索。
  references: z.array(ReferenceIndexSchema).max(1000),
  // 尚未确认的问题；阻塞项不能靠声明覆盖完成来忽略。
  unresolvedItems: z
    .array(
      z.object({
        // 可解释的问题描述和原始源码位置。
        description: text,
        range: SourceRangeSchema,
        // 是否阻止进入最终生成阶段。
        blocking: z.boolean(),
        // 区分跨块边界、语义缺口和外部依赖缺失。
        kind: z.enum(['boundary', 'semantic', 'dependency']),
        // 关联的片段或单元身份，无法绑定时为 null。
        unitId: z.string().nullable()
      })
    )
    .max(100),
  // 实际完整读到并分析的偏移区间，用其并集计算覆盖，不能填未读区域。
  analyzedRanges: z.array(OffsetRangeSchema).max(1000),
  // 当前索引的完整性声明，仍需通过程序覆盖和边界校验。
  status: z.enum(['partial', 'complete']),
  // 索引协议版本，用于拒绝不兼容的结构。
  schemaVersion: z.literal('2')
})
/** 从源单元发出的关系；只有证据验证通过的 resolved 关系才能作为确认调用。 */
export const CrossFileReferenceSchema = z.object({
  // 程序建立的关系身份，核对阶段不能擅自替换候选集合。
  referenceId: z.string(),
  // 关系发起方的正式执行单元身份。
  sourceUnitId: z.string(),
  // 有具体调用位置时关联对应调用点。
  callSiteId: z.string().optional(),
  // 已找到的候选或确认目标；无法定位时可缺省。
  targetUnitId: z.string().optional(),
  // 保留目标名线索，方便解释未解决的关系。
  targetHint: text,
  // 导入依赖、调用、注册、请求具有不同语义。
  kind: z.enum(['call', 'import', 'registration', 'request']),
  // 已证实、仅推断、未解决；相似度和同名不足以标记 resolved。
  status: z.enum(['resolved', 'inferred', 'unresolved']),
  // 调用、导入和目标定义等原始证据。
  evidenceIds: ids,
  // 对外可解释的结论说明，不包含内部推理。
  diagnostic: text
})
/** 关系核对角色的结构化提交格式。 */
export const ReferenceVerificationSchema = z.object({
  // 本批次候选的核对结论，后续仍由程序检查身份及证据。
  references: z.array(CrossFileReferenceSchema).max(100)
})
/** 模型仅提交单元内的节点和边；全局 ID、映射与 Mermaid 由程序生成。 */
export const UnitFlowDraftSchema = z.object({
  // 本任务指定的正式单元身份，不能返回其他单元。
  unitId: z.string(),
  // 单元局部节点，范围必须落在该单元实际源码中。
  nodes: z
    .array(
      z.object({
        // 只需在本单元唯一，组图时转换为全局 nodeId。
        localId: z.string().min(1).max(100),
        // 节点形状对应的语义种类。
        kind: NodeKindSchema,
        // 图上显示的短文本。
        label: z.string().min(1).max(160),
        // 节点的功能说明，用于映射详情和追问上下文。
        description: text,
        // 原始源码位置及支撑它的读取证据。
        range: SourceRangeSchema,
        evidenceIds: ids,
        // 节点承载的调用点，用于把已确认关系连接到具体图节点。
        callSiteIds: ids
      })
    )
    .max(500),
  // from/to 引用本任务的 localId，label 表示分支条件等边说明。
  edges: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string().max(160) }))
    .max(1000),
  // 局部入口节点；纯声明没有执行流程时为 null。
  entryLocalId: z.string().nullable(),
  // 无节点时必须解释原因，不能用空流程掩盖可执行单元生成失败。
  emptyReason: text
})
/** 用户可见的降级或分析提示，避免暴露供应商原始异常及源码正文。 */
export const PublicDiagnosticSchema = z.object({
  // 稳定诊断码及中文说明。
  code: z.string(),
  message: text,
  // 可选的文件或具体源码位置，用于定位问题。
  fileId: z.string().optional(),
  range: SourceRangeSchema.optional()
})
/** 范围覆盖与阻塞缺口检查；覆盖完整不等于能证明所有语义理解正确。 */
export const CoverageSchema = z.object({
  // 所有文件范围已覆盖且阻塞问题已解决时才为 true。
  complete: z.boolean(),
  // 仍未确认的单元边界或阻塞语义位置。
  unresolvedRanges: z.array(SourceRangeSchema).optional(),
  // 每个文件按 UTF-16 字符偏移统计，重叠范围只计算一次。
  files: z.array(
    z.object({
      // 覆盖统计所属的快照文件。
      fileId: z.string(),
      // 文件原始字符串长度。
      total: z.number().int(),
      // 已分析范围并集的长度。
      covered: z.number().int(),
      // 尚未覆盖的半开区间。
      missing: z.array(OffsetRangeSchema)
    })
  )
})
/** 最终图节点与原始源码的一一映射；继承的 fileId 用于前端切换文件。 */
export const MultiFileNodeMappingSchema = SourceRangeSchema.extend({
  // 程序分配的全局 ID，必须与 Mermaid 节点完全一致。
  nodeId: z.string(),
  // 所属执行单元，用于关联局部流程及追问上下文。
  unitId: z.string(),
  // 与图节点同步的语义类型、标签和功能说明。
  kind: NodeKindSchema,
  label: z.string(),
  description: text,
  // 节点位置对应的实际读取凭证。
  evidenceIds: ids
})
/** v2 生成的完整对外结果；SSE 分事件传输后，前端重新组装为此结构。 */
export const MultiFileFlowResultSchema = z.object({
  // 区分原有单文件结果协议。
  version: z.literal(2),
  // 固定源码版本与本次分析身份，前端据此拒绝串流结果混用。
  snapshotId: z.string(),
  analysisId: z.string(),
  // 复用程序调用 Jev 的结果，生成模型不能覆盖它。
  detectedLanguage: SupportedLanguageSchema,
  // 纯声明项目可为 false，此时 mermaid 和 mappings 应为空。
  hasExecutableFlow: z.boolean(),
  // 经程序受控序列化的图文本。
  mermaid: z.string(),
  // 与图中所有节点双向覆盖的源码映射。
  mappings: z.array(MultiFileNodeMappingSchema),
  // 检索降级、关系歧义等公开提示。
  diagnostics: z.array(PublicDiagnosticSchema),
  // 最终源码范围覆盖情况。
  coverage: CoverageSchema
})
export type ExecutionUnit = z.infer<typeof ExecutionUnitSchema>
export type FileSemanticIndex = z.infer<typeof FileSemanticIndexSchema>
export type CrossFileReference = z.infer<typeof CrossFileReferenceSchema>
export type UnitFlowDraft = z.infer<typeof UnitFlowDraftSchema>
export type MultiFileFlowResult = z.infer<typeof MultiFileFlowResultSchema>
export type PublicDiagnostic = z.infer<typeof PublicDiagnosticSchema>
