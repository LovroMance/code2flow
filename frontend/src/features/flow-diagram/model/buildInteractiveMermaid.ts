import type { NodeMapping } from '../../../entities/flow/model/types'

export function buildInteractiveMermaid(source: string, mappings: NodeMapping[]) {
  if (mappings.length === 0) {
    return source
  }

  const clickLines = mappings.map((mapping) => `click ${mapping.nodeId} code2flowNodeClick`)
  return `${source}\n${clickLines.join('\n')}`
}
