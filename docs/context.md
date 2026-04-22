# Code2Flow Context

## 项目一句话

Code2Flow 是一个把 JavaScript、TypeScript、Vue 前端代码转换成 Mermaid 流程图，并建立节点到代码行映射关系的 Agent 项目。

## 当前目标

- 继续围绕阶段一 MVP 推进
- 保持阶段一 / 阶段二总体规划不变
- 在现有可运行骨架上逐步把 mock 替换成更真实的解析与模型能力

## 当前代码状态

- 前端已经有工作台页面：
  - 代码输入区
  - 流程图展示区
  - 节点映射列表
  - 状态区与操作按钮
- 前端已经接入：
  - Monaco Editor
  - Mermaid 渲染
  - 点击节点联动到代码行高亮
  - `fetch` 读取 SSE
  - `axios` 调用普通接口
- 后端已经接入：
  - `GET /api/health`
  - `POST /api/generate-flow`
  - Zod 请求校验
  - SSE 返回 `mermaid / mappings / done / error`
- 当前 Agent 仍然是 mock 结果，不是真实 LangChain / LangGraph 推理

## 当前技术栈

- 前端：Vue 3、TypeScript、Vite、Monaco Editor、Mermaid、Axios
- 后端：Node.js、Express、TypeScript、Zod
- 预留能力：LangChain、LangGraph

## 当前约束

- 只使用 Vue / 通用前端示例，不引入 React 专项示例
- Prompt 输出必须保持严格 JSON 协议
- Mermaid 输出必须可渲染
- 节点必须能映射回代码行
- 阶段一优先做闭环，不提前塞入阶段二复杂对话能力

## 重要提醒

- 这个仓库之前做过一轮更激进的实验性改动，后续又回退到了当前 commit
- 新会话不要默认假设“更真实解析器”“LangChain 接入”“性能重构”等实验性修改仍然存在
- 以当前文件内容为准，不以历史对话记忆为准

## 新会话建议阅读顺序

1. `docs/context.md`
2. `docs/session-handoff.md`
3. `AGENTS.md`
4. `docs/current-status.md`
5. `docs/architecture.md`
6. `docs/阶段一.md`
7. `docs/prompt-spec.md`
