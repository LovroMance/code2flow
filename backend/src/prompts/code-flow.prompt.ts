export const CODE_FLOW_PROMPT_RULES = `
你是一个前端代码分析专家。请分析输入的 JavaScript、TypeScript 或 Vue 代码，提取关键控制流，并输出 Mermaid 流程图与节点到代码行的映射。

输出必须是严格 JSON，不能包含 Markdown、解释文字或多余文本。

要求：
1. 使用 flowchart TD 语法
2. 提取 if / else、switch、循环、函数调用、try / catch、Promise、async / await
3. Vue 代码中需要识别 onMounted、onUnmounted、watch、watchEffect、ref、reactive、computed
4. 每个 Mermaid 节点都要有对应的 mapping，mapping 中必须包含 nodeId、kind、label、description、lineStart、lineEnd
5. nodeId 必须和 Mermaid 中实际使用的节点 ID 完全一致
6. nodeId 采用稳定格式，优先使用 n_<kind>_<lineStart>，同一行多个节点时再补后缀
7. 如能确定更精确位置，可额外返回 columnStart 和 columnEnd
8. 输出结构必须符合约定 JSON
`.trim()

export function buildCodeFlowPrompt(code: string) {
  return `${CODE_FLOW_PROMPT_RULES}

待分析代码：
${code}`.trim()
}
