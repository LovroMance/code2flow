import { ModelOutputValidationError } from '../domain/multifile/errors'
import { posix } from 'node:path'
import type { SourceContext } from './source-context.service'
import type {
  CrossFileReference,
  ExecutionUnit,
  FileSemanticIndex
} from '../domain/multifile/schema'
import type { SourceSnapshot } from '../domain/source/schema'
import { importDeclarationRanges } from '../utils/sourceChunks'
import { coveredLines, sourceRange } from '../utils/sourcePositions'

type IndexedReference = FileSemanticIndex['references'][number]

function bindingMatches(reference: IndexedReference, text: string) {
  return (
    (reference.name === 'default' || reference.name === '*' || text.includes(reference.name)) &&
    !!reference.alias &&
    text.includes(reference.alias) &&
    text.includes(reference.targetPath)
  )
}

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

/** 索引时补全可由原文唯一确认的导入证据。 */
export async function completeIndexReferences(index: FileSemanticIndex, context: SourceContext) {
  const file = context.snapshot.files.find((file) => file.fileId === index.fileId)!
  const content = context.repository.content(context.snapshot, file.fileId)
  let declarations: Awaited<ReturnType<typeof importDeclarationRanges>> | undefined
  for (const ref of index.references) {
    context.validate(ref.range, ref.evidenceIds)
    if (ref.kind !== 'import' || !ref.targetPath) continue
    const { startOffset, endOffset } = ref.range
    if (bindingMatches(ref, content.slice(startOffset, endOffset))) continue
    declarations ??= await importDeclarationRanges(file.path, content)
    const matches = declarations.filter((declaration) =>
      declaration.startOffset < endOffset &&
      declaration.endOffset > startOffset &&
      (declaration.targetPath === undefined || declaration.targetPath === ref.targetPath) &&
      bindingMatches(ref, content.slice(declaration.startOffset, declaration.endOffset))
    )
    if (matches.length === 1) {
      const match = matches[0]!
      const range = sourceRange(file.fileId, content, match.startOffset, match.endOffset)
      const { evidence } = context.read(file.fileId, range.startOffset, range.endOffset)
      ref.range = range
      ref.evidenceIds = [evidence.evidenceId]
    } else if (context.snapshot.files.some((target) => pathMatches(file.path, ref.targetPath, target.path))) {
      const { lineStart, lineEnd } = coveredLines(ref.range)
      throw new ModelOutputValidationError(
        `${file.path} 第 ${lineStart}–${lineEnd} 行的导入证据缺少完整绑定。` +
        `请提交同时覆盖名称 ${ref.name}、本地名称 ${ref.alias} 和路径 ${ref.targetPath} 的完整导入声明行范围。`
      )
    }
  }
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
/** 校验已选中的唯一目标及其绑定证据，调用文本已在索引阶段校验。 */
export function validateResolvedReference(
  ref: CrossFileReference,
  context: SourceContext,
  { unit: source, call, imports, scopeEvidence }: ReturnType<typeof referenceCandidates>[number],
  target: ExecutionUnit
) {
  if (ref.kind === 'request' || ref.kind === 'import')
    throw new ModelOutputValidationError('该关系不能作为确定执行边。')
  context.validate(call.range, ref.evidenceIds)
  context.validate(target.range, ref.evidenceIds)
  const targetText = context.repository
    .content(context.snapshot, target.range.fileId)
    .slice(target.range.startOffset, target.range.endOffset)
  if (!target.name || !targetText.includes(target.name))
    throw new ModelOutputValidationError('目标声明缺少名称证据。')
  if (source.range.fileId !== target.range.fileId) {
    if (!imports.length && !scopeEvidence.length)
      throw new ModelOutputValidationError('跨文件调用缺少导入、注册或包作用域依据。')
    imports.forEach((r) => {
      context.validate(r.range, ref.evidenceIds)
      const text = context.repository
        .content(context.snapshot, r.range.fileId)
        .slice(r.range.startOffset, r.range.endOffset)
      if (!bindingMatches(r, text))
        throw new ModelOutputValidationError('绑定线索与原始文本不一致。')
    })
    for (const scope of scopeEvidence) {
      context.validate(scope.range, ref.evidenceIds)
      if (
        !context.repository
          .content(context.snapshot, scope.range.fileId)
          .slice(scope.range.startOffset, scope.range.endOffset)
          .includes(scope.name)
      )
        throw new ModelOutputValidationError('作用域声明与原始文本不一致。')
    }
  } else if (call.receiver) {
    throw new ModelOutputValidationError('动态接收者缺少可证明的绑定，保留未解析。')
  }
}
