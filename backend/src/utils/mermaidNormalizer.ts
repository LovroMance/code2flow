export function normalizeMermaidSource(input: string) {
  // 保留标签的双引号，括号等特殊字符需要由 Mermaid 的引号语法保护。
  return input.replace(/\r/g, '').trim()
}
