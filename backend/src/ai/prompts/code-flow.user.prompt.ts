export function buildCodeFlowUserPrompt(code: string) {
  return `
请只根据下面这段代码生成结果。

返回值必须是一个严格 JSON 对象，不能包含 Markdown 代码块、解释文字或额外前后缀。
必须同时返回：
- mermaid: 完整的 Mermaid flowchart TD 字符串
- mappings: 节点映射数组

再次强调：
- 顶层字段名必须是 mappings，不是 mapping
- 不能漏掉 mermaid
- 不能只返回 mappings
- 不能添加额外顶层字段

代码如下：
${code}
  `.trim()
}
