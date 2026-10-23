import type { ExecutionUnit, FileSemanticIndex } from '../domain/multifile/schema'
import { sourceRange } from './sourcePositions'
export class FragmentConflictError extends Error {
  constructor(readonly range: ExecutionUnit['range']) {
    super(`单元边界冲突，未完成范围：${JSON.stringify(range)}`)
  }
}

/** 只合并实际重叠、同作用域且身份兼容的片段，不按同名或相邻顺序拼接。
 * 边界矛盾交回索引阶段修复。
 */
export function mergeFileFragments(
  fileId: string,
  content: string,
  parts: FileSemanticIndex[]
): FileSemanticIndex[] {
  const clusters: ExecutionUnit[] = []
  const compatible = (a: ExecutionUnit, b: ExecutionUnit) =>
    ((a.name && a.name === b.name) ||
      (a.signature && a.signature === b.signature) ||
      (a.complete &&
        b.complete &&
        a.range.startOffset === b.range.startOffset &&
        a.range.endOffset === b.range.endOffset)) &&
    a.scope === b.scope &&
    a.kind === b.kind &&
    a.range.startOffset < b.range.endOffset &&
    b.range.startOffset < a.range.endOffset
  const units = parts
    .flatMap((part) => part.units)
    .sort(
      (a, b) => a.range.startOffset - b.range.startOffset || b.range.endOffset - a.range.endOffset
    )
  for (const unit of units) {
    const old = clusters.find(
      (candidate) =>
        compatible(candidate, unit) &&
        (!candidate.complete ||
          !unit.complete ||
          (candidate.range.startOffset === unit.range.startOffset &&
            candidate.range.endOffset === unit.range.endOffset))
    )
    if (!old) {
      clusters.push({
        ...unit,
        boundary: { ...unit.boundary },
        controlRanges: [...unit.controlRanges],
        callSites: [...unit.callSites],
        evidenceIds: [...unit.evidenceIds]
      })
      continue
    }
    if (
      (old.boundary.startKnown &&
        unit.boundary.startKnown &&
        old.range.startOffset !== unit.range.startOffset) ||
      (old.boundary.endKnown &&
        unit.boundary.endKnown &&
        old.range.endOffset !== unit.range.endOffset)
    )
      throw new FragmentConflictError(unit.range)
    const start = Math.min(old.range.startOffset, unit.range.startOffset),
      end = Math.max(old.range.endOffset, unit.range.endOffset)
    const startKnown =
      (old.range.startOffset === start && old.boundary.startKnown) ||
      (unit.range.startOffset === start && unit.boundary.startKnown)
    const endKnown =
      (old.range.endOffset === end && old.boundary.endKnown) ||
      (unit.range.endOffset === end && unit.boundary.endKnown)
    old.range = sourceRange(fileId, content, start, end)
    old.boundary = { startKnown, endKnown }
    old.complete = startKnown && endKnown
    old.evidenceIds = [...new Set([...old.evidenceIds, ...unit.evidenceIds])]
    old.controlRanges = [
      ...new Map(
        [...old.controlRanges, ...unit.controlRanges].map((range) => [
          JSON.stringify([range.kind, range.range]),
          range
        ])
      ).values()
    ]
    old.callSites = [
      ...new Map(
        [...old.callSites, ...unit.callSites].map((call) => [
          JSON.stringify([call.kind, call.range, call.targetHint]),
          call
        ])
      ).values()
    ]
  }
  const unresolvedItems = parts.flatMap((part) =>
    part.unresolvedItems.filter((item) => {
      if (item.kind !== 'boundary' || !item.unitId) return true
      const fragment = part.units.find((unit) => unit.unitId === item.unitId)
      if (!fragment) return true
      return !clusters.some(
        (unit) =>
          unit.complete &&
          unit.name === fragment.name &&
          unit.scope === fragment.scope &&
          unit.kind === fragment.kind &&
          unit.range.startOffset <= fragment.range.startOffset &&
          unit.range.endOffset >= fragment.range.endOffset
      )
    })
  )
  return [
    {
      fileId,
      summary: parts
        .map((part) => part.summary)
        .join('；')
        .slice(0, 1000),
      units: clusters,
      references: parts.flatMap((part) => part.references),
      unresolvedItems,
      analyzedRanges: parts.flatMap((part) => part.analyzedRanges),
      status:
        clusters.every((unit) => unit.complete) && !unresolvedItems.some((item) => item.blocking)
          ? 'complete'
          : 'partial',
      schemaVersion: '2'
    }
  ]
}
