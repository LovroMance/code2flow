// 仅为模型创建带行号的分析副本，保留空行、注释和缩进，与原始源码位置对应。
export function numberSourceLines(code: string) {
  return code
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => `${index + 1} | ${line}`)
    .join('\n')
}
