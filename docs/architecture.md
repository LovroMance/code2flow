# Code2Flow Architecture

## 总体结构

```text
code2flow-agent/
├── frontend/
├── backend/
├── docs/
├── AGENTS.md
└── package.json
```

## 前端职责

- 提供代码输入界面
- 展示 Mermaid 流程图
- 展示节点到代码行映射
- 处理节点点击联动
- 处理 SSE 流式结果

当前关键文件：

- `frontend/src/App.vue`
- `frontend/src/components/CodeEditor.vue`
- `frontend/src/components/FlowDiagram.vue`
- `frontend/src/composables/useAgentStream.ts`

## 后端职责

- 接收代码分析请求
- 构造 Prompt
- 调用模型或 Agent 流程
- 校验结构化输出
- 校验 Mermaid 语法
- 用 SSE 返回结果

当前关键文件：

- `backend/src/index.ts`
- `backend/src/agent.ts`
- `backend/src/prompts.ts`
- `backend/src/types.ts`
- `backend/src/utils/mermaidValidator.ts`

## 当前请求流

1. 前端提交代码到 `POST /api/generate-flow`
2. 后端校验请求体
3. Agent 生成 Mermaid 和 mappings
4. 后端校验 Mermaid
5. 后端通过 SSE 返回：
   - `mermaid`
   - `mappings`
   - `done`

## 阶段一推荐实现顺序

1. 固化 `types.ts` 的输出结构
2. 固化 `prompts.ts` 的 Prompt 模板
3. 用 mock 结果打通 `/api/generate-flow`
4. 前端接入请求和流式状态
5. 接入 Monaco
6. 接入 Mermaid 渲染
7. 做节点点击联动

## 阶段二扩展点

- 引入多轮对话状态
- 增加追问型接口或在现有 Agent 流扩展追问处理
- 强化 Vue 生命周期、响应式副作用和状态派生分析
