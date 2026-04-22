# Code2Flow Prompt Spec

## Purpose

This document defines the prompt contract for Code2Flow so prompt design, backend schema validation, and frontend rendering all stay aligned.

The prompt should instruct the model to analyze frontend code and return:

- Mermaid flowchart source
- node-to-code-line mappings
- stable, structured JSON only

## Supported Input Scope

- JavaScript
- TypeScript
- Vue Single File Component logic

Current focus:

- `if / else`
- `switch`
- `for`, `while`, iteration logic
- function calls
- `Promise`
- `async / await`
- `try / catch`
- Vue lifecycle and reactive logic in script blocks

Out of scope for the first version:

- full template rendering flow analysis
- CSS behavior analysis
- bundler or routing graph analysis

## Output Contract

### Required JSON Shape

```json
{
  "mermaid": "flowchart TD\nA[Start] --> B{Condition}",
  "mappings": [
    {
      "nodeId": "A",
      "lineStart": 1,
      "lineEnd": 1,
      "description": "Function start"
    }
  ]
}
```

## Field Rules

### `mermaid`

- Must be a valid Mermaid `flowchart TD` string
- Must only contain nodes and edges needed to explain the code flow clearly
- Should prefer readable labels over overly literal code dumps

### `mappings`

- Must be an array
- Every rendered node should have a corresponding mapping
- `nodeId` must match a node ID used in the Mermaid source
- `lineStart` and `lineEnd` must refer to source code lines
- `description` should be concise and readable in Chinese or English, but stay consistent within one response

## Analysis Rules

- Identify control flow, not every syntax token
- Group linear logic when it improves readability
- Split decision points clearly
- Represent async steps as explicit nodes when they materially affect flow
- Preserve branch direction for `if / else`, `switch`, error handling, and early returns

## Vue-Specific Rules

- Treat `onMounted` and `onUnmounted` as lifecycle nodes
- Treat `watch` and `watchEffect` as reactive side-effect nodes
- Treat important `ref` and `reactive` state changes as state update nodes
- Treat `computed` as derived-state nodes when it affects downstream logic
- Treat event handlers and async requests as separate nodes when they represent meaningful user or network actions

## Prohibited Prompt Content

- Do not use React-specific examples
- Do not mention `useEffect`, `useState`, or React lifecycle patterns
- Do not ask for hidden reasoning to be exposed in the final answer
- Do not allow markdown wrappers or natural-language preambles in output

## System Prompt Template

```text
你是一个前端代码分析专家。请分析输入的 JavaScript、TypeScript 或 Vue 代码，提取关键控制流，并输出 Mermaid 流程图与节点到代码行的映射。

输出必须是严格 JSON，不能包含 Markdown、解释文字或多余文本。

要求：
1. 使用 flowchart TD 语法
2. 提取 if / else、switch、循环、函数调用、try / catch、Promise、async / await
3. Vue 代码中需要识别 onMounted、onUnmounted、watch、watchEffect、ref、reactive、computed
4. 每个 Mermaid 节点都要有对应的 lineStart 和 lineEnd
5. 输出结构必须符合约定 JSON
```

## Few-Shot Example 1

### Input

```js
async function loadUser() {
  const user = await fetchUser()

  if (user.isActive) {
    goToDashboard()
  } else {
    showInactiveMessage()
  }
}
```

### Output

```json
{
  "mermaid": "flowchart TD\nA[开始] --> B[获取用户]\nB --> C{用户已激活?}\nC -->|是| D[进入仪表盘]\nC -->|否| E[显示未激活提示]",
  "mappings": [
    {
      "nodeId": "A",
      "lineStart": 1,
      "lineEnd": 1,
      "description": "函数开始"
    },
    {
      "nodeId": "B",
      "lineStart": 2,
      "lineEnd": 2,
      "description": "异步获取用户"
    },
    {
      "nodeId": "C",
      "lineStart": 4,
      "lineEnd": 4,
      "description": "判断用户状态"
    },
    {
      "nodeId": "D",
      "lineStart": 5,
      "lineEnd": 5,
      "description": "跳转到仪表盘"
    },
    {
      "nodeId": "E",
      "lineStart": 7,
      "lineEnd": 7,
      "description": "显示未激活提示"
    }
  ]
}
```

## Few-Shot Example 2

### Input

```vue
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const keyword = ref('')

onMounted(() => {
  loadList()
})

watch(keyword, async () => {
  await loadList()
})
</script>
```

### Output

```json
{
  "mermaid": "flowchart TD\nA[初始化] --> B[onMounted]\nB --> C[加载列表]\nC --> D[等待关键字变化]\nD --> E[watch 触发]\nE --> F[重新加载列表]",
  "mappings": [
    {
      "nodeId": "A",
      "lineStart": 4,
      "lineEnd": 4,
      "description": "定义关键字状态"
    },
    {
      "nodeId": "B",
      "lineStart": 6,
      "lineEnd": 8,
      "description": "组件挂载生命周期"
    },
    {
      "nodeId": "C",
      "lineStart": 7,
      "lineEnd": 7,
      "description": "首次加载列表"
    },
    {
      "nodeId": "D",
      "lineStart": 10,
      "lineEnd": 12,
      "description": "监听关键字变化"
    },
    {
      "nodeId": "E",
      "lineStart": 10,
      "lineEnd": 12,
      "description": "watch 副作用触发"
    },
    {
      "nodeId": "F",
      "lineStart": 11,
      "lineEnd": 11,
      "description": "根据新关键字重新加载列表"
    }
  ]
}
```

## Backend Integration Notes

- Keep the canonical prompt text in `backend/src/prompts.ts`
- Mirror this output contract in `backend/src/types.ts`
- Reject invalid model output before it reaches the frontend
- Add Mermaid validation after parsing and before final success response

## Future Extension Notes

- Stage 2 may add a `summary` or explanation field, but stage 1 should keep the schema minimal
- If follow-up Q&A is introduced, it should not break the existing generation payload shape
