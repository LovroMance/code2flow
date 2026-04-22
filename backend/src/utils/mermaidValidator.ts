export function validateMermaid(input: string) {
  return input.startsWith('flowchart TD') && input.includes('-->')
}
