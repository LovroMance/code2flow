import { ModelOutputValidationError } from '../domain/multifile/errors'
import { lineOffsets } from './sourcePositions'
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
  if (!unit) throw new ModelOutputValidationError('生成结果单元身份错误。')
  if (!unit.complete) throw new ModelOutputValidationError('局部流程的执行单元边界尚未确认。')
  const ids = new Set<string>()
  for (const node of draft.nodes) {
    if (node.kind === 'start')
      throw new ModelOutputValidationError('start节点由程序合成，不需要提交。')
    if (ids.has(node.localId)) throw new ModelOutputValidationError('局部节点ID重复。')
    ids.add(node.localId)
    context.validate(node.range, node.evidenceIds)
    if (
      node.range.fileId !== unit.range.fileId ||
      node.range.startOffset < unit.range.startOffset ||
      node.range.endOffset > unit.range.endOffset
    )
      throw new ModelOutputValidationError('节点不在目标单元内。')
    for (const id of node.callSiteIds) {
      const call = unit.callSites.find((c) => c.callSiteId === id)
      if (
        !call ||
        call.range.startOffset < node.range.startOffset ||
        call.range.endOffset > node.range.endOffset
      )
        throw new ModelOutputValidationError('调用点没有落在对应节点内。')
    }
  }
  if (
    draft.nodes.length
      ? !draft.entryLocalId || !ids.has(draft.entryLocalId)
      : draft.entryLocalId !== null || !draft.emptyReason || unit.kind !== 'declaration'
  )
    throw new ModelOutputValidationError('局部入口或空流程说明无效。')
  for (const edge of draft.edges)
    if (!ids.has(edge.from) || !ids.has(edge.to))
      throw new ModelOutputValidationError('局部边引用未知节点。')
  for (const control of unit.controlRanges) {
    const mapped = draft.nodes.filter(
      (node) =>
        node.range.startOffset <= control.range.startOffset &&
        node.range.endOffset >= control.range.endOffset
    )
    if (!mapped.length) {
      // 反馈携带控制位置的类型与原文，模型能精确定位漏掉的语句。
      const text = context.repository
        .content(context.snapshot, unit.range.fileId)
        .slice(control.range.startOffset, control.range.endOffset)
      throw new ModelOutputValidationError(
        `局部流程遗漏索引中的关键控制位置：${control.kind}（行${control.range.lineStart}:${control.range.columnStart}-${control.range.lineEnd}:${control.range.columnEnd}）原文"${text}"；请为该语句补充节点，range覆盖它。`
      )
    }
    if (
      (control.kind === 'branch' || control.kind === 'loop') &&
      !mapped.some(
        (node) =>
          node.kind === 'decision' &&
          draft.edges.filter((edge) => edge.from === node.localId).length >= 2
      )
    )
      throw new ModelOutputValidationError(
        `控制位置行${control.range.lineStart}（${control.kind}）需要kind=decision的节点覆盖，且该节点至少有两条出边表示分支。`
      )
    if (
      control.kind === 'return' &&
      !mapped.some((node) => node.kind === 'return' || node.kind === 'end')
    )
      throw new ModelOutputValidationError(
        `控制位置行${control.range.lineStart}（return）需要kind=return或end的节点覆盖。`
      )
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
    // 入口节点由程序合成，映射到单元声明行，模型只提交有语义含量的节点。
    const content = context.repository.content(context.snapshot, file.fileId),
      offsets = lineOffsets(content),
      declStart = offsets[unit.range.lineStart - 1] ?? unit.range.startOffset,
      declEndRaw = offsets[unit.range.lineStart] ?? content.length
    let declEnd = declEndRaw
    while (declEnd > declStart && /[\r\n]/.test(content[declEnd - 1]!)) declEnd--
    const startId = `n_start_${unit.range.lineStart}_f${f + 1}_u${u + 1}_0`,
      startLabel = escapeMermaidLabel(`开始 ${unit.name || unit.kind}`)
    lines.push(`${startId}(["${startLabel}"])`)
    mappings.push({
      fileId: file.fileId,
      startOffset: declStart,
      endOffset: declEnd,
      lineStart: unit.range.lineStart,
      lineEnd: unit.range.lineStart,
      columnStart: 1,
      columnEnd: declEnd - declStart + 1,
      nodeId: startId,
      unitId: draft.unitId,
      kind: 'start',
      label: `开始 ${unit.name || unit.kind}`,
      description: `执行单元 ${unit.name || unit.kind} 的入口`,
      evidenceIds: unit.evidenceIds
    })
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
    const entryId = nodeIds.get(`${draft.unitId}:${draft.entryLocalId}`)
    if (entryId) lines.push(`${startId} --> ${entryId}`)
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
