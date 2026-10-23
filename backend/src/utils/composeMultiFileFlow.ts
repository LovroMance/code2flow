import {
  MultiFileFlowResultSchema,
  type CrossFileReference,
  type UnitFlowDraft,
  type MultiFileFlowResult
} from '../domain/multifile/schema'
import type { SourceContext } from '../services/source-context.service'

/** 校验局部节点的源码证据、入口、边端点及关键控制位置，失败交回图重试。 */
export function validateUnitDraft(draft: UnitFlowDraft, context: SourceContext) {
  const unit = context.indexes.flatMap((i) => i.units).find((u) => u.unitId === draft.unitId)
  if (!unit) throw new Error('生成结果单元身份错误。')
  if (!unit.complete) throw new Error('局部流程的执行单元边界尚未确认。')
  const ids = new Set<string>()
  for (const node of draft.nodes) {
    if (ids.has(node.localId)) throw new Error('局部节点ID重复。')
    ids.add(node.localId)
    context.validate(node.range, node.evidenceIds)
    if (
      node.range.fileId !== unit.range.fileId ||
      node.range.startOffset < unit.range.startOffset ||
      node.range.endOffset > unit.range.endOffset
    )
      throw new Error('节点不在目标单元内。')
    for (const id of node.callSiteIds) {
      const call = unit.callSites.find((c) => c.callSiteId === id)
      if (
        !call ||
        call.range.startOffset < node.range.startOffset ||
        call.range.endOffset > node.range.endOffset
      )
        throw new Error('调用点没有落在对应节点内。')
    }
  }
  if (
    draft.nodes.length
      ? !draft.entryLocalId || !ids.has(draft.entryLocalId)
      : draft.entryLocalId !== null || !draft.emptyReason || unit.kind !== 'declaration'
  )
    throw new Error('局部入口或空流程说明无效。')
  for (const edge of draft.edges)
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error('局部边引用未知节点。')
  for (const control of unit.controlRanges) {
    const mapped = draft.nodes.filter(
      (node) =>
        node.range.startOffset <= control.range.startOffset &&
        node.range.endOffset >= control.range.endOffset
    )
    if (!mapped.length) throw new Error('局部流程遗漏索引中的关键控制位置。')
    if (
      (control.kind === 'branch' || control.kind === 'loop') &&
      !mapped.some(
        (node) =>
          node.kind === 'decision' &&
          draft.edges.filter((edge) => edge.from === node.localId).length >= 2
      )
    )
      throw new Error('局部流程没有保留判断或循环分支。')
    if (
      control.kind === 'return' &&
      !mapped.some((node) => node.kind === 'return' || node.kind === 'end')
    )
      throw new Error('局部流程没有保留返回边界。')
  }
}
// 所有模型文本先编码成 Mermaid 数字实体，不允许注入指令、URL 或点击脚本。
export function escapeMermaidLabel(text: string) {
  return [...text]
    .map((char) =>
      /[\p{L}\p{N} ，。？！：、（）_-]/u.test(char) ? char : `#${char.codePointAt(0)};`
    )
    .join('')
}
/** 稳定排序局部流程，统一分配全局 ID，并从同一节点数据生成 Mermaid 和映射。 */
export function composeMultiFileFlow(
  context: SourceContext,
  drafts: UnitFlowDraft[],
  references: CrossFileReference[],
  base: Omit<MultiFileFlowResult, 'mappings' | 'mermaid' | 'hasExecutableFlow'>
) {
  const units = context.indexes.flatMap((i) => i.units),
    files = context.snapshot.files
  const sorted = [...drafts].sort(
    (a, b) =>
      files.findIndex((f) => f.fileId === units.find((u) => u.unitId === a.unitId)!.range.fileId) -
        files.findIndex(
          (f) => f.fileId === units.find((u) => u.unitId === b.unitId)!.range.fileId
        ) ||
      units.find((u) => u.unitId === a.unitId)!.range.startOffset -
        units.find((u) => u.unitId === b.unitId)!.range.startOffset ||
      a.unitId.localeCompare(b.unitId)
  )
  const mappings: MultiFileFlowResult['mappings'] = [],
    lines = ['flowchart TD'],
    nodeIds = new Map<string, string>(),
    entries = new Map<string, string>(),
    callNodes = new Map<string, string>()
  sorted.forEach((draft, u) => {
    validateUnitDraft(draft, context)
    if (!draft.nodes.length) return
    const unit = units.find((i) => i.unitId === draft.unitId)!,
      file = files.find((f) => f.fileId === unit.range.fileId)!,
      f = files.indexOf(file)
    lines.push(
      `subgraph g_${u}["${escapeMermaidLabel(`${file.path} · ${unit.name || unit.kind}`)}"]`
    )
    const nodes = [...draft.nodes].sort(
      (a, b) => a.range.startOffset - b.range.startOffset || a.localId.localeCompare(b.localId)
    )
    nodes.forEach((node, n) => {
      const id = `n_${node.kind}_${node.range.lineStart}_f${f + 1}_u${u + 1}_${n + 1}`,
        label = escapeMermaidLabel(node.label)
      nodeIds.set(`${draft.unitId}:${node.localId}`, id)
      for (const call of node.callSiteIds) callNodes.set(call, id)
      if (node.localId === draft.entryLocalId) entries.set(draft.unitId, id)
      lines.push(
        node.kind === 'decision'
          ? `${id}{"${label}"}`
          : node.kind === 'start' || node.kind === 'end'
            ? `${id}(["${label}"])`
            : `${id}["${label}"]`
      )
      mappings.push({
        ...node.range,
        nodeId: id,
        unitId: draft.unitId,
        kind: node.kind,
        label: node.label,
        description: node.description,
        evidenceIds: node.evidenceIds
      })
    })
    for (const edge of draft.edges)
      lines.push(
        `${nodeIds.get(`${draft.unitId}:${edge.from}`)} -->${edge.label ? `|"${escapeMermaidLabel(edge.label)}"|` : ''} ${nodeIds.get(`${draft.unitId}:${edge.to}`)}`
      )
    lines.push('end')
  })
  // 跨单元仅连接已证实的调用/注册；导入和请求关系不能直接充当本地执行边。
  for (const ref of references) {
    if (ref.status !== 'resolved' || (ref.kind !== 'call' && ref.kind !== 'registration')) continue
    const from = callNodes.get(ref.callSiteId ?? ''),
      to = entries.get(ref.targetUnitId ?? '')
    if (!from || !to) throw new Error('已确认关联缺少调用节点或目标入口。')
    lines.push(`${from} -.->|"${ref.kind === 'call' ? '调用' : '触发'}"| ${to}`)
  }
  if (new Set(mappings.map((m) => m.nodeId)).size !== mappings.length)
    throw new Error('最终节点ID重复。')
  const mermaid = mappings.length ? lines.join('\n') : ''
  // 图源完全由受控结构生成，双向覆盖和标签使用同一来源；实际语法解析由前端执行。
  return MultiFileFlowResultSchema.parse({
    ...base,
    mermaid,
    mappings,
    hasExecutableFlow: !!mappings.length
  })
}
