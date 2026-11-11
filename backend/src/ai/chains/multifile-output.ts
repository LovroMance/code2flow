import type { Evidence, SourceRange } from '../../domain/source/schema'
import type {
  CombinedIndexSubmission,
  FileSemanticIndex,
  UnitFlowDraft,
  UnitFlowSubmission
} from '../../domain/multifile/schema'
import { coveredLines, sourceLineRange } from '../../utils/sourcePositions'
import { ModelOutputValidationError } from '../../domain/multifile/errors'

const internalRangeFields = ['columnStart', 'columnEnd', 'startOffset', 'endOffset']
const internalPayloadFields = new Set([
  ...internalRangeFields,
  'contentHash',
  'evidenceIds',
  'metering',
  'linePositions',
  'byteSize',
  'lineCount',
  'chunkerVersion',
  'strategy'
])

/** 模型读取的范围使用首尾都包含的行号。 */
export function slimModelInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slimModelInput)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const out = Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) =>
          !internalPayloadFields.has(key) &&
          !(key === 'complete' && typeof record.unitId === 'string') &&
          !(key === 'snapshotId' && typeof record.evidenceId === 'string')
      )
      .map(([key, item]) => [key, slimModelInput(item)])
  )
  const { lineStart, lineEnd, columnEnd } = record
  if (typeof lineStart === 'number' && typeof lineEnd === 'number' && typeof columnEnd === 'number')
    Object.assign(out, coveredLines({ lineStart, lineEnd, columnEnd }))
  return out
}

/** 按任务文件恢复内部坐标，模型只提交原始行号。 */
export function modelRangeResolver(fileId: string, content: string, offsets: number[]) {
  return ({ lineStart, lineEnd }: Pick<SourceRange, 'lineStart' | 'lineEnd'>) => {
    try {
      return sourceLineRange(fileId, content, lineStart, lineEnd, offsets)
    } catch {
      throw new ModelOutputValidationError(`源码行范围无效：第 ${lineStart}–${lineEnd} 行，首尾均包含。`)
    }
  }
}

export function restoreModelDraft(
  draft: UnitFlowSubmission,
  unitId: string,
  evidenceIds: string[],
  resolve: ReturnType<typeof modelRangeResolver>
): UnitFlowDraft {
  return {
    ...draft,
    unitId,
    emptyReason: draft.emptyReason ?? undefined,
    nodes: draft.nodes.map((node) => ({ ...node, range: resolve(node.range), evidenceIds }))
  }
}

export function restoreModelIndex(
  submission: CombinedIndexSubmission,
  evidence: Evidence,
  resolve: ReturnType<typeof modelRangeResolver>
) {
  const { drafts = [], ...fields } = submission
  const evidenceIds = [evidence.evidenceId]
  const index: FileSemanticIndex = {
    ...fields,
    fileId: evidence.fileId,
    units: fields.units.map((unit) => ({
      ...unit,
      scope: unit.scope ?? '',
      signature: unit.signature ?? '',
      range: resolve(unit.range),
      controlRanges: unit.controlRanges.map((item) => ({ ...item, range: resolve(item.range) })),
      callSites: unit.callSites.map((call) => ({
        ...call,
        receiver: call.receiver ?? undefined,
        range: resolve(call.range),
        evidenceIds
      })),
      evidenceIds,
      complete: true
    })),
    references: fields.references.map((ref) => ({
      ...ref,
      alias: ref.alias ?? ref.name,
      targetPath: ref.targetPath ?? '',
      range: resolve(ref.range),
      evidenceIds
    })),
    unresolvedItems: fields.unresolvedItems.map((item) => ({ ...item, range: resolve(item.range) })),
    status: fields.unresolvedItems.some((item) => item.blocking) ? 'partial' : 'complete',
    schemaVersion: '2'
  }
  const unitIds = new Set(index.units.map(({ unitId }) => unitId))
  return {
    index,
    drafts: drafts
      .filter(({ unitId }) => unitIds.has(unitId))
      .map((draft) => restoreModelDraft(draft, draft.unitId, evidenceIds, resolve))
  }
}
