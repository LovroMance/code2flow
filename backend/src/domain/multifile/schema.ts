import { z } from 'zod'
import { NodeKindSchema } from '../flow/schema'
import { SupportedLanguageSchema } from '../flow/language'
import { SourceLineRangeSchema, SourceRangeSchema } from '../source/schema'

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
/** 可独立生成局部流程的语义单元。 */
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
  // 单元在原始正文中的范围。
  range: SourceRangeSchema,
  // 供源码检索使用的签名线索。
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
  // 新索引由程序登记完整单元，历史索引可能含有未完成的片段。
  complete: z.boolean()
})
/** 文件中的导入、导出及作用域线索，本身不等于执行调用边。 */
export const ReferenceIndexSchema = z.object({
  // scope 表示源码显式声明的包或命名空间。
  kind: z.enum(['import', 'export', 'registration', 'request', 'scope']),
  // 被导入、导出或声明的原名。
  name: text,
  // 本地绑定名称，省略时由程序使用原名。
  alias: text,
  // 源码中的目标路径或模块路径线索。
  targetPath: text,
  // 线索语句的位置及其读取凭证。
  range: SourceRangeSchema,
  evidenceIds: ids
})
/** 持久化语义索引，不包含最终 Mermaid。 */
export const FileSemanticIndexSchema = z.object({
  // 索引只属于一个快照文件。
  fileId: z.string(),
  // 文件职责摘要，供检索使用。
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
        // boundary 和 unitId 用于兼容历史索引。
        kind: z.enum(['boundary', 'semantic', 'dependency']),
        unitId: z.string().nullable().optional()
      })
    )
    .max(100),
  // 由程序根据阻塞项计算索引状态。
  status: z.enum(['partial', 'complete']),
  // 索引协议版本，用于拒绝不兼容的结构。
  schemaVersion: z.literal('2')
})

const IndexSubmissionSchema = FileSemanticIndexSchema.omit({
  fileId: true,
  status: true,
  schemaVersion: true
}).extend({
  units: z
    .array(ExecutionUnitSchema.omit({ complete: true, evidenceIds: true })
      .partial({ scope: true, signature: true })
      .extend({
        range: SourceLineRangeSchema,
        controlRanges: z.array(ExecutionUnitSchema.shape.controlRanges.element.extend({
          range: SourceLineRangeSchema
        })).max(500),
        callSites: z.array(CallSiteSchema.omit({ evidenceIds: true }).extend({
          range: SourceLineRangeSchema,
          text: text.describe('range 内逐字截取的单行调用片段，跨行时取含调用名的一行'),
          targetHint: text.describe('range 内逐字出现的目标名或路径线索')
        })).max(500)
      }))
    .max(1000),
  references: z.array(ReferenceIndexSchema.omit({ evidenceIds: true })
    .partial({ alias: true, targetPath: true })
    .extend({ range: SourceLineRangeSchema })).max(1000),
  unresolvedItems: z
    .array(
      FileSemanticIndexSchema.shape.unresolvedItems.element.omit({ unitId: true }).extend({
        kind: z.enum(['semantic', 'dependency']),
        range: SourceLineRangeSchema
      })
    )
    .max(100)
})
/** 从源单元发出的关系；只有证据验证通过的 resolved 关系才能作为确认调用。 */
export const CrossFileReferenceSchema = z.object({
  // 程序建立的关系身份。
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
  // 兼容历史分析记录中的 inferred。
  status: z.enum(['resolved', 'inferred', 'unresolved']),
  // 调用、导入和目标定义等原始证据。
  evidenceIds: ids,
  // 对外可解释的结论说明，不包含内部推理。
  diagnostic: text
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
  emptyReason: text.optional()
})
/** 独立生成的目标单元、文件和证据由任务绑定。 */
export const UnitFlowSubmissionSchema = UnitFlowDraftSchema.omit({ unitId: true }).extend({
  nodes: z.array(UnitFlowDraftSchema.shape.nodes.element.omit({ evidenceIds: true }).extend({
    localId: UnitFlowDraftSchema.shape.nodes.element.shape.localId.describe('单元内唯一'),
    kind: NodeKindSchema.exclude(['start']),
    range: SourceLineRangeSchema.describe('职责覆盖的实际语句，须在单元内'),
    callSiteIds: ids.describe('该节点范围内的调用点 ID')
  })).max(500),
  edges: UnitFlowDraftSchema.shape.edges.describe('from/to 引用单元内的 localId，label 写分支条件'),
  entryLocalId: UnitFlowDraftSchema.shape.entryLocalId.describe('首个语义节点的 localId，纯声明用 null')
})
/** 分块索引和局部草稿同轮产出。草稿缺失时仍可复用有效索引。 */
export const CombinedIndexSchema = IndexSubmissionSchema.extend({
  drafts: z.array(UnitFlowSubmissionSchema.extend({ unitId: ExecutionUnitSchema.shape.unitId })).max(500).optional()
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
/** 阻塞缺口检查；文件级范围完整性已由切块与索引阶段保证，此处不再重复统计。 */
export const CoverageSchema = z.object({
  // 没有阻塞问题需要定点补读时为 true。
  complete: z.boolean(),
  // 仍未确认的阻塞语义位置。
  unresolvedRanges: z.array(SourceRangeSchema).optional()
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
  // 流式传输的结果协议版本。
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
export type UnitFlowSubmission = z.infer<typeof UnitFlowSubmissionSchema>
export type CombinedIndexSubmission = z.infer<typeof CombinedIndexSchema>
export type MultiFileFlowResult = z.infer<typeof MultiFileFlowResultSchema>
export type PublicDiagnostic = z.infer<typeof PublicDiagnosticSchema>
