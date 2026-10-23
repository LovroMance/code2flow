import type { NodeMapping } from '../../../entities/flow/model/types'

// Monaco 将文件头 BOM 保存在文本模型元数据中，列号不包含 BOM；接口仍引用原文。
/** 将原文映射转换为 Monaco 选区：保留 UTF-16 规则，修正首行 BOM 的显示列差异。 */
export function mappingSelection(
  mapping: NodeMapping,
  source: string,
  lineMaxColumn: (line: number) => number
) {
  const bom = source.startsWith('\uFEFF') ? 1 : 0
  return {
    startLineNumber: mapping.lineStart,
    startColumn: Math.max(1, (mapping.columnStart ?? 1) - (mapping.lineStart === 1 ? bom : 0)),
    endLineNumber: mapping.lineEnd,
    endColumn:
      mapping.columnEnd === undefined
        ? lineMaxColumn(mapping.lineEnd)
        : Math.max(1, mapping.columnEnd - (mapping.lineEnd === 1 ? bom : 0))
  }
}
