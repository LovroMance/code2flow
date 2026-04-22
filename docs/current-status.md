# Code2Flow Current Status

## 已完成

- 阶段文档、Prompt 规范、协作规则已经整理到 `docs/` 和 `AGENTS.md`
- 根目录已使用 npm workspaces 管理 `frontend/` 和 `backend/`
- 前端工作台已落地：
  - 工作台页面
  - Monaco Editor
  - Mermaid 图渲染
  - 节点映射列表
  - 节点点击联动到编辑器行号高亮
- 前端接口层已分开：
  - 普通接口走 `axios`
  - 流式接口走 `fetch + ReadableStream`
- 后端接口已落地：
  - `GET /api/health`
  - `POST /api/generate-flow`
- 后端已具备：
  - Zod 请求校验
  - Mermaid 校验
  - SSE 事件写回
  - mock Agent 输出
- 工程化基础已经在仓库里：
  - ESLint
  - Prettier
  - Husky
  - lint-staged

## 当前仍是占位 / mock 的部分

- `backend/src/agents/code-flow.agent.ts` 仍返回固定 Mermaid 和固定 mappings
- Prompt 模板已存在，但还没有真实模型调用
- LangChain / LangGraph 依赖已安装，但业务尚未真正接入
- 当前 nodeId 仍是简单的 `A / B / C / D / E`

## 当前最值得继续推进的方向

1. 把后端 mock 结果升级成更贴近真实代码结构的生成逻辑
2. 设计稳定的 nodeId 规则，并让 Mermaid 与 mappings 严格共用
3. 再在此基础上接入 LangChain
4. 最后视需要引入 LangGraph 处理校验重试和多轮状态

## 启动方式

```bash
npm run dev
```

- 前端默认在 `http://localhost:5173`
- 后端默认在 `http://localhost:3000`

## 注意点

- 现有文档比最初骨架阶段更接近真实代码，但仍需要持续和代码保持同步
- 新会话不要默认假设“更真实 mock 解析器”或“LangChain 已接入”，当前仓库还没有这些实现
