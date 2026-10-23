import { posix } from 'node:path'
import type { SourceContext } from './source-context.service'
import type {
  CrossFileReference,
  ExecutionUnit,
  FileSemanticIndex
} from '../domain/multifile/schema'
import type { SourceSnapshot } from '../domain/source/schema'

function pathMatches(source: string, hint: string, target: string) {
  if (!hint) return false
  const resolved = hint.startsWith('.')
    ? [posix.normalize(posix.join(posix.dirname(source), hint))]
    : [hint, posix.normalize(posix.join(posix.dirname(source), hint)), hint.replace(/\./g, '/')]
  // 兼容相对路径、项目内路径和点分模块名；仅构造候选，唯一性及原文绑定另行校验。
  return resolved.some(
    (path) =>
      target === path ||
      target.replace(/\.[^/.]+$/, '') === path ||
      target.replace(/\/(?:index|__init__)\.[^/.]+$/, '') === path
  )
}
/** 依据导入路径、别名、接收者及显式作用域枚举候选，同名本身不能确认关系。 */
export function referenceCandidates(snapshot: SourceSnapshot, indexes: FileSemanticIndex[]) {
  const all = indexes.flatMap((i) => i.units)
  return all.flatMap((unit) =>
    unit.callSites.map((call) => {
      const index = indexes.find((i) => i.fileId === unit.range.fileId)!,
        path = snapshot.files.find((f) => f.fileId === index.fileId)!.path
      const imports = index.references.filter(
        (r) =>
          (r.kind === 'import' || r.kind === 'registration') &&
          (r.alias === call.targetHint || r.name === call.targetHint || r.alias === call.receiver)
      )
      const imported = imports.flatMap((ref) =>
        all.filter((target) => {
          const targetPath = snapshot.files.find((f) => f.fileId === target.range.fileId)!.path
          const member = call.targetHint.split(/::|\.|->/).pop()
          const exportedDefault =
            ref.name === 'default' &&
            indexes
              .find((i) => i.fileId === target.range.fileId)!
              .references.some(
                (r) =>
                  r.kind === 'export' &&
                  (r.name === 'default' || r.alias === 'default') &&
                  (r.name === target.name ||
                    r.alias === target.name ||
                    r.range.startOffset === target.range.startOffset)
              )
          return (
            pathMatches(path, ref.targetPath, targetPath) &&
            (target.name === ref.name ||
              target.name === call.targetHint ||
              (ref.name === '*' && target.name === member) ||
              exportedDefault)
          )
        })
      )
      const local = all.filter(
        (target) =>
          target.range.fileId === unit.range.fileId &&
          target.name === call.targetHint &&
          (target.scope === unit.scope || target.scope === '' || target.unitId === unit.unitId)
      )
      const sourceScope = index.references.filter(
        (r) => r.kind === 'scope' && r.name === unit.scope && !!unit.scope
      )
      const scopeTargets = all.filter(
        (target) =>
          target.range.fileId !== unit.range.fileId &&
          target.name === call.targetHint &&
          target.scope === unit.scope &&
          sourceScope.length > 0 &&
          posix.dirname(snapshot.files.find((f) => f.fileId === target.range.fileId)!.path) ===
            posix.dirname(path) &&
          indexes
            .find((i) => i.fileId === target.range.fileId)!
            .references.some((r) => r.kind === 'scope' && r.name === unit.scope)
      )
      const scopeEvidence = [
        ...sourceScope,
        ...scopeTargets.flatMap((target) =>
          indexes
            .find((i) => i.fileId === target.range.fileId)!
            .references.filter((r) => r.kind === 'scope' && r.name === target.scope)
        )
      ]
      const candidates = [
        ...new Map([...imported, ...local, ...scopeTargets].map((u) => [u.unitId, u])).values()
      ]
      return { unit, call, imports, candidates, scopeEvidence }
    })
  )
}
// resolved 是静态依据已核对，不意味着运行时必然执行；保守保留动态目标。
/** 对模型提交的已确认关系做原始结构证据检查，拒绝仅凭搜索相似度建立连边。 */
export function validateResolvedReference(
  ref: CrossFileReference,
  context: SourceContext,
  units: ExecutionUnit[]
) {
  const source = units.find((u) => u.unitId === ref.sourceUnitId),
    target = units.find((u) => u.unitId === ref.targetUnitId)
  const call = source?.callSites.find((c) => c.callSiteId === ref.callSiteId)
  if (!source || !call) throw new Error('关系引用的调用点不存在。')
  for (const id of ref.evidenceIds)
    if (!context.accessible.has(id)) throw new Error('关系证据不属于当前任务。')
  if (ref.status !== 'resolved') return
  if (!source.complete || !target?.complete) throw new Error('关系单元边界尚未确认。')
  if (!target || ref.kind === 'request' || ref.kind === 'import')
    throw new Error('该关系不能作为确定执行边。')
  context.validate(call.range, ref.evidenceIds)
  context.validate(target.range, ref.evidenceIds)
  const callText = context.repository
    .content(context.snapshot, call.range.fileId)
    .slice(call.range.startOffset, call.range.endOffset)
  if (!callText.includes(call.text) || !callText.includes(call.targetHint))
    throw new Error('调用文本与引用线索没有源码依据。')
  const targetText = context.repository
    .content(context.snapshot, target.range.fileId)
    .slice(target.range.startOffset, target.range.endOffset)
  if (!target.name || !targetText.includes(target.name)) throw new Error('目标声明缺少名称证据。')
  const indexes = context.indexes,
    candidate = referenceCandidates(context.snapshot, indexes).find(
      (c) => c.call.callSiteId === call.callSiteId
    )
  if (
    !candidate ||
    candidate.candidates.length !== 1 ||
    candidate.candidates[0]!.unitId !== target.unitId
  )
    throw new Error('目标不唯一或缺少路径、作用域绑定依据。')
  if (source.range.fileId !== target.range.fileId) {
    const imports = candidate.imports
    if (!imports.length && !candidate.scopeEvidence.length)
      throw new Error('跨文件调用缺少导入、注册或包作用域依据。')
    imports.forEach((r) => {
      context.validate(r.range, ref.evidenceIds)
      const text = context.repository
        .content(context.snapshot, r.range.fileId)
        .slice(r.range.startOffset, r.range.endOffset)
      if (
        (r.name !== 'default' && r.name !== '*' && !text.includes(r.name)) ||
        !r.alias ||
        !text.includes(r.alias) ||
        !text.includes(r.targetPath)
      )
        throw new Error('绑定线索与原始文本不一致。')
    })
    for (const scope of candidate.scopeEvidence) {
      context.validate(scope.range, ref.evidenceIds)
      if (
        !context.repository
          .content(context.snapshot, scope.range.fileId)
          .slice(scope.range.startOffset, scope.range.endOffset)
          .includes(scope.name)
      )
        throw new Error('作用域声明与原始文本不一致。')
    }
  } else if (call.receiver) {
    throw new Error('动态接收者缺少可证明的绑定，保留未解析。')
  }
}
