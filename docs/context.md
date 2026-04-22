# Code2Flow Context

## 项目一句话

Code2Flow 是一个将 JavaScript、TypeScript、Vue 前端代码转换成 Mermaid 流程图，并建立节点到代码行映射的 Agent 项目。

## 当前目标

- 先完成阶段一 MVP
- 保持总体规划不变
- 优先把前后端主链路所需基础设施搭稳

## 当前仓库状态

- 已完成文档拆分：
  - `docs/阶段一.md`
  - `docs/阶段二.md`
- 已补充 AI / 协作规范：
  - `AGENTS.md`
  - `docs/prompt-spec.md`
  - `docs/scripts-plan.md`
- 已搭好前后端骨架：
  - `frontend/`：Vue 3 + Vite
  - `backend/`：Express + TypeScript
- 已改为 npm workspaces：
  - 根目录执行一次 `npm install` 即可安装全部依赖

## 阶段一必须完成的能力

- 代码输入
- Agent 生成 Mermaid 流程图
- 节点到代码行映射
- 点击节点高亮代码
- SSE 流式返回
- Mermaid 结果校验与重试

## 阶段二增强能力

- 对话式追问
- 多轮会话上下文
- 更强的 Vue 响应式逻辑识别
- 更完整的解释性输出

## 技术栈

### 前端

- Vue 3
- TypeScript
- Vite
- Monaco Editor
- Mermaid.js
- TailwindCSS

### 后端

- Node.js
- Express
- TypeScript
- LangGraph
- LangChain OpenAI
- Zod

## 当前约束

- 只使用 Vue / 通用前端示例，不使用 React 示例
- Prompt 输出必须是严格 JSON
- Mermaid 输出必须可渲染
- 所有节点都要能映射回代码行
- 阶段一不要提前塞入阶段二复杂能力

## 新会话建议入口

新的协作会话建议优先读取：

1. `docs/context.md`
2. `AGENTS.md`
3. `docs/阶段一.md`
4. `docs/prompt-spec.md`
