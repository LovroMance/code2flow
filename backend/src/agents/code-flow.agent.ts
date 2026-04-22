import type { FlowGenerationResult } from '../domain/flow/types'
import { generateCodeFlowWithLangChain } from '../ai/chains/code-flow.chain'
import { generateCodeFlowWithGraph } from '../ai/graph/code-flow.graph'
import { buildCodeFlowPrompt } from '../prompts/code-flow.prompt'
import { validateMermaid } from '../utils/mermaidValidator'

export function createCodeFlowAgent() {
  return {
    async generate(code: string): Promise<FlowGenerationResult> {
      const provider = process.env.CODE2FLOW_AGENT_PROVIDER ?? 'mock'

      if (provider === 'langchain') {
        return generateCodeFlowWithLangChain(code)
      }

      if (provider === 'graph') {
        return generateCodeFlowWithGraph(code)
      }

      const prompt = buildCodeFlowPrompt(code)

      const result: FlowGenerationResult = {
        mermaid:
          'flowchart TD\nn_start_1[开始] --> n_action_1[读取代码]\nn_action_1 --> n_decision_2{分析结构}\nn_decision_2 --> n_action_4[输出流程图]\nn_action_4 --> n_return_5[返回映射]',
        mappings: [
          {
            nodeId: 'n_start_1',
            kind: 'start',
            label: '开始',
            lineStart: 1,
            lineEnd: 1,
            description: '开始分析输入代码'
          },
          {
            nodeId: 'n_action_1',
            kind: 'action',
            label: '读取代码',
            lineStart: 1,
            lineEnd: 2,
            description: '读取并整理输入代码'
          },
          {
            nodeId: 'n_decision_2',
            kind: 'decision',
            label: '分析结构',
            lineStart: 2,
            lineEnd: 4,
            description: '分析控制流与关键分支'
          },
          {
            nodeId: 'n_action_4',
            kind: 'action',
            label: '输出流程图',
            lineStart: 4,
            lineEnd: 5,
            description: '生成 Mermaid 流程图'
          },
          {
            nodeId: 'n_return_5',
            kind: 'return',
            label: '返回映射',
            lineStart: 5,
            lineEnd: 5,
            description: '返回节点与代码行映射'
          }
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
