# Code2Flow

Code2Flow 是一个将 JavaScript、TypeScript、Vue 前端代码转换为 Mermaid 流程图的 Agent 项目。

## 当前结构

- `frontend/`：Vue 3 + Vite 工作区，集成 Monaco 编辑与 Mermaid 节点定位
- `backend/`：Express + TypeScript 服务，使用 LangChain / LangGraph 生成与追问
- `docs/`：阶段规划、Prompt 规范、脚本规划
- `AGENTS.md`：项目协作规则

## 启动前准备

使用 Node.js 22 或更新版本。根目录已启用 npm workspaces，先在根目录安装一次依赖即可：

```bash
npm install
```

首次运行时将 `backend/.env.example` 复制为 `backend/.env`（已有文件保留），填写 `DEEPSEEK_API_KEY`。后端统一使用 LangChain `createAgent` 和 LangGraph `StateGraph`；无需再设置 provider。会话默认保存在本地 SQLite，无需 Docker，旧 JSON 会话可按需只读导入。

## 常用命令

```bash
npm run dev
npm run build
npm run check
```

前端访问 `http://localhost:5173`，后端健康检查为 `http://localhost:3000/api/health`。后端测试使用 `npm run test:backend`；当前前端尚无测试文件，根目录 `check` 中的前端测试步骤仍需后续补齐。

目前可先专注业务代码 `backend/src/`。自动化测试已统一移至 `backend/tests/` 保留，日常启动和构建无需运行测试。

架构见 [docs/architecture.md](./docs/architecture.md)，本次框架迁移与代码行数见 [重构报告](./docs/langchain-langgraph-refactor/重构报告.md)。
