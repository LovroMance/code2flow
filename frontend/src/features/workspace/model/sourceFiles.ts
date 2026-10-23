import type { SourceFileInput, SourceSnapshot } from '../../../entities/flow/model/multifile'

/** 路径和正文决定快照是否过期；文件顺序与当前活动文件不影响比较。 */
export function equalSourceFiles(a: SourceFileInput[], b: SourceFileInput[]) {
  const canonical = (files: SourceFileInput[]) =>
    JSON.stringify(files.map((f) => [f.path, f.content]).sort((a, b) => a[0]!.localeCompare(b[0]!)))
  return canonical(a) === canonical(b)
}
/** 通过快照 fileId 找回当前工作区文件，找不到时禁止定位到其他文件。 */
export function mappingFilePath(
  fileId: string,
  snapshot: SourceSnapshot,
  files: SourceFileInput[]
) {
  const file = snapshot.files.find((file) => file.fileId === fileId)
  return file && files.some((f) => f.path === file.path) ? file.path : undefined
}
