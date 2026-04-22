export function buildCodeFlowUserPrompt(code: string) {
  return `
请只根据下面这段代码生成结果。

返回值必须是一个严格 JSON 对象，不能包含 Markdown 代码块、解释文字或额外前后缀。

代码如下：
${code}
  `.trim()
}
