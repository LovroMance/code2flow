export const CODE_FLOW_PROMPT_RULES = `
你是一个代码控制流分析专家。请分析输入代码的关键控制流，并生成 Mermaid 流程图与节点到代码行的映射。

你必须通过工具调用完成任务，不能直接输出 JSON、Markdown 或解释文字。

你必须严格遵循以下顺序：
1. 先调用 detect_language 工具识别当前代码语言
2. 再调用 submit_code_flow_result 工具提交最终结果

最终提交结果时，必须包含以下字段：
1. detectedLanguage
2. mermaid
3. mappings

返回结果示例：
{
  "detectedLanguage": "typescript",
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
2. 提取 if / else、switch、循环、函数调用、try / catch、异常处理、返回分支
3. 对 JavaScript、TypeScript、Vue、Java、C、C++、Python、Go、Rust、C#、PHP 保持兼容
4. 每个 Mermaid 节点都要有对应的 mapping，mapping 中必须包含 nodeId、kind、label、description、lineStart、lineEnd
5. nodeId 必须和 Mermaid 中实际使用的节点 ID 完全一致
6. nodeId 采用稳定格式，优先使用 n_<kind>_<lineStart>，同一行多个节点时再补后缀
7. 如能确定更精确位置，可额外返回 columnStart 和 columnEnd
8. detectedLanguage 必须与 detect_language 工具返回的 language 一致
9. kind 只能使用 start、action、decision、return、end 这 5 个枚举值
10. mermaid 字段不能为空，必须是完整可渲染的 Mermaid flowchart TD 字符串
11. mappings 数组中的每个节点都必须在 mermaid 中真实出现
12. mappings 的 lineStart 和 lineEnd 必须落在实际执行代码行，不能落在注释行、空行或只包含大括号的行
13. 如果节点前面有说明性注释，description 可以参考注释语义，但映射必须指向注释后的第一条真实代码语句
14. 在 detect_language 完成之前，不要提交最终结果
`.trim()

export function buildCodeFlowPrompt(code: string) {
  return `${CODE_FLOW_PROMPT_RULES}

待分析代码：
${code}`.trim()
}
