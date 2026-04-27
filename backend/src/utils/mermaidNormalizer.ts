export function normalizeMermaidSource(input: string) {
  return (
    input
      .replace(/\r/g, '')
      // Mermaid 节点标签里直接出现双引号时容易触发解析问题，先统一转成单引号。
      .replace(/"/g, "'")
      .trim()
  )
}
