# Code2Flow Architecture

## 总体结构

```text
code2flow-agent/
├── frontend/
│   └── src/
│       ├── app/
│       ├── entities/
│       ├── features/
│       ├── pages/
│       └── shared/
├── backend/
│   └── src/
│       ├── agents/
│       ├── app/
│       ├── controllers/
│       ├── domain/
│       ├── prompts/
│       ├── routes/
│       ├── services/
│       └── utils/
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

- `frontend/src/app/App.vue`
- `frontend/src/pages/workspace/WorkspacePage.vue`
- `frontend/src/features/code-editor/ui/CodeEditor.vue`
- `frontend/src/features/flow-diagram/ui/FlowDiagram.vue`
- `frontend/src/features/workspace/model/useWorkspacePage.ts`
- `frontend/src/features/flow-generation/model/useFlowGeneration.ts`
- `frontend/src/shared/api/system.api.ts`
- `frontend/src/shared/api/flow-stream.api.ts`

## 后端职责

- 接收代码分析请求
- 构造 Prompt
- 调用 LangChain 或 LangGraph 代码流分析流程
- 校验结构化输出
- 校验 Mermaid 语法
- 用 SSE 返回结果

当前关键文件：

- `backend/src/index.ts`
- `backend/src/app/createApp.ts`
- `backend/src/controllers/flow.controller.ts`
- `backend/src/services/flow-generation.service.ts`
- `backend/src/agents/code-flow.agent.ts`
- `backend/src/prompts/code-flow.prompt.ts`
- `backend/src/domain/flow/schema.ts`
- `backend/src/domain/flow/types.ts`
- `backend/src/utils/mermaidValidator.ts`

## 当前请求流

1. 前端提交代码到 `POST /api/generate-flow`
2. 后端校验请求体
3. `flow-generation.service` 调用 `code-flow.agent`
4. Agent 生成 Mermaid 和 mappings
5. 后端校验 Mermaid
6. 后端通过 SSE 返回：
   - `mermaid`
   - `mappings`
   - `done`

## 阶段一推荐实现顺序

1. 保持当前前后端协议稳定
2. 设计稳定的 nodeId 规则
3. 持续优化 LangChain 输出质量与稳定性
4. 用 LangGraph 承接重试和校验流程
5. 再考虑会话状态等阶段二能力

## 阶段二扩展点

- 引入多轮对话状态
- 增加追问型接口或在现有 Agent 流扩展追问处理
- 强化 Vue 生命周期、响应式副作用和状态派生分析
