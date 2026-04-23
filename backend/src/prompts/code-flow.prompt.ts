export const CODE_FLOW_PROMPT_RULES = `
你是一个前端代码分析专家。请分析输入的 JavaScript、TypeScript 或 Vue 代码，提取关键控制流，并输出 Mermaid 流程图与节点到代码行的映射。

输出必须是严格 JSON，不能包含 Markdown、解释文字或多余文本。

你的返回值必须且只能是一个 JSON 对象，并且这个对象必须同时包含以下两个顶层字段：
1. mermaid
2. mappings

如果缺少 mermaid 或缺少 mappings，你的输出就是错误的。
禁止使用 mapping 作为字段名，必须使用 mappings。
禁止输出除 mermaid 和 mappings 以外的任何顶层字段。

返回格式示例：
{
  "mermaid": "flowchart TD\\nn_start_1[开始] --> n_action_2[获取用户]\\nn_action_2 --> n_decision_4{用户已激活?}\\nn_decision_4 -->|是| n_action_5[进入仪表盘]\\nn_decision_4 -->|否| n_action_7[显示未激活提示]",
  "mappings": [
    {
      "nodeId": "n_start_1",
      "kind": "start",
      "label": "开始",
      "description": "函数开始",
      "lineStart": 1,
      "lineEnd": 1
    }
  ]
}

要求：
1. 使用 flowchart TD 语法
2. 提取 if / else、switch、循环、函数调用、try / catch、Promise、async / await
3. Vue 代码中需要识别 onMounted、onUnmounted、watch、watchEffect、ref、reactive、computed
4. 每个 Mermaid 节点都要有对应的 mapping，mapping 中必须包含 nodeId、kind、label、description、lineStart、lineEnd
5. nodeId 必须和 Mermaid 中实际使用的节点 ID 完全一致
6. nodeId 采用稳定格式，优先使用 n_<kind>_<lineStart>，同一行多个节点时再补后缀
7. 如能确定更精确位置，可额外返回 columnStart 和 columnEnd
8. 输出结构必须符合约定 JSON
9. 顶层字段名必须使用 mappings，不能使用 mapping
10. kind 只能使用 start、action、decision、return、end 这 5 个枚举值
11. mermaid 字段不能为空，必须是完整可渲染的 Mermaid flowchart TD 字符串
12. mappings 数组中的每个节点都必须在 mermaid 中真实出现
`.trim()

export function buildCodeFlowPrompt(code: string) {
  return `${CODE_FLOW_PROMPT_RULES}

待分析代码：
${code}`.trim()
}
