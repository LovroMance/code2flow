export function buildCodeFlowUserPrompt(code: string) {
  return `
请只根据下面这段代码完成分析。

你必须先调用 detect_language 工具，再调用 submit_code_flow_result 工具。
不要直接输出自然语言说明。

再次强调：
- 最终结果必须包含 detectedLanguage、mermaid、mappings
- detectedLanguage 必须与 detect_language 返回值一致
- lineStart 和 lineEnd 必须指向真实执行代码，不能指向注释、空行或仅有大括号的行
- 如果注释描述了下面的逻辑，description 可以参考注释，但映射必须落到注释后的实际代码行

代码如下：
${code}
  `.trim()
}
