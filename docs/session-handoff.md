# Code2Flow Session Handoff

## 这个文件的用途

当开启新会话时，先读这份文档，再决定下一步做什么。它的目标是让新的协作者快速恢复上下文，并避免被过时记忆带偏。

## 当前仓库在做什么

- 项目目标不变：把前端代码转换成 Mermaid 流程图，并建立节点到代码行映射
- 当前已经不是纯文档阶段，而是一个可运行的前后端骨架
- 当前主链路已经通到：
  - 前端点击“生成流程图”
  - 后端返回 mock SSE
  - 前端渲染 Mermaid
  - 点击节点联动 Monaco 行号高亮

## 当前代码不是哪些状态

- 不是“只有占位 UI、没有前后端交互”的最早版本
- 不是“已经完成真实解析器和稳定 nodeId 规则”的增强版本
- 不是“已经接入 LangChain / LangGraph”的模型版本

## 建议先读的文件

1. `docs/context.md`
2. `docs/current-status.md`
3. `docs/architecture.md`
4. `docs/阶段一.md`
5. `docs/prompt-spec.md`
6. `AGENTS.md`

## 关键文件落点

### 前端

- 页面编排：`frontend/src/pages/workspace/WorkspacePage.vue`
- 页面状态：`frontend/src/features/workspace/model/useWorkspacePage.ts`
- 流式生成：`frontend/src/features/flow-generation/model/useFlowGeneration.ts`
- 编辑器：`frontend/src/features/code-editor/ui/CodeEditor.vue`
- 流程图：`frontend/src/features/flow-diagram/ui/FlowDiagram.vue`
- 普通接口：`frontend/src/shared/api/system.api.ts`
- 流式接口：`frontend/src/shared/api/flow-stream.api.ts`

### 后端

- 应用入口：`backend/src/index.ts`
- App 创建：`backend/src/app/createApp.ts`
- 路由注册：`backend/src/routes/index.ts`
- 生成接口：`backend/src/controllers/flow.controller.ts`
- 业务服务：`backend/src/services/flow-generation.service.ts`
- mock Agent：`backend/src/agents/code-flow.agent.ts`
- Prompt：`backend/src/prompts/code-flow.prompt.ts`
- 领域类型：`backend/src/domain/flow/schema.ts`, `backend/src/domain/flow/types.ts`

## 当前最推荐继续做的事

1. 优先升级后端 mock 生成逻辑，让输出更贴近真实代码结构
2. 设计稳定的 nodeId 规则，让 Mermaid 与 mappings 严格共用同一套 ID
3. 在协议稳定后接入 LangChain
4. 如果需要重试、自校验、多轮状态，再引入 LangGraph

## 新会话建议提示词

可以直接这样开场：

```text
请先阅读 docs/context.md、docs/session-handoff.md、docs/current-status.md、docs/architecture.md 和 AGENTS.md，再基于当前代码状态继续开发，不要假设 LangChain 或增强版 mock 解析器已经接入。
```
