import type { FlowGenerationResult } from '../domain/flow/types'
import { buildCodeFlowPrompt } from '../prompts/code-flow.prompt'
import { validateMermaid } from '../utils/mermaidValidator'

export function createCodeFlowAgent() {
  return {
    async generate(code: string): Promise<FlowGenerationResult> {
      const prompt = buildCodeFlowPrompt(code)

      const result: FlowGenerationResult = {
        mermaid:
          'flowchart TD\nA[开始] --> B[读取代码]\nB --> C{分析结构}\nC --> D[输出流程图]\nD --> E[返回映射]',
        mappings: [
          { nodeId: 'A', lineStart: 1, lineEnd: 1, description: '开始分析' },
          { nodeId: 'B', lineStart: 1, lineEnd: 2, description: '读取输入代码' },
          { nodeId: 'C', lineStart: 2, lineEnd: 4, description: '分析控制流' },
          { nodeId: 'D', lineStart: 4, lineEnd: 5, description: '生成 Mermaid' },
          { nodeId: 'E', lineStart: 5, lineEnd: 5, description: '返回节点映射' }
        ]
      }

      if (!validateMermaid(result.mermaid)) {
        throw new Error('Generated Mermaid is invalid')
      }

      void prompt
      return result
    }
  }
}
