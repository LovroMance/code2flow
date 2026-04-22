import { ref } from 'vue'

interface NodeMapping {
  nodeId: string
  lineStart: number
  lineEnd: number
  description: string
}

export function useAgentStream() {
  const status = ref('skeleton')
  const mermaid = ref(
    'flowchart TD\nA[开始] --> B[分析代码]\nB --> C{生成流程图}\nC --> D[返回节点映射]'
  )
  const mappings = ref<NodeMapping[]>([
    { nodeId: 'A', lineStart: 1, lineEnd: 1, description: '函数开始' },
    { nodeId: 'B', lineStart: 2, lineEnd: 2, description: '分析代码逻辑' },
    { nodeId: 'C', lineStart: 4, lineEnd: 4, description: '生成流程图节点' },
    { nodeId: 'D', lineStart: 5, lineEnd: 5, description: '返回结果' }
  ])

  return {
    status,
    mermaid,
    mappings
  }
}
