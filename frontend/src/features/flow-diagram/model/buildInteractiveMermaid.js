export function buildInteractiveMermaid(source, mappings) {
  if (mappings.length === 0) {
    return source
  }
  const clickLines = mappings.map((mapping) => `click ${mapping.nodeId} code2flowNodeClick`)
  return `${source}\n${clickLines.join('\n')}`
}
