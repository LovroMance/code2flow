# Code2Flow

Code2Flow 是一个将主流编程语言代码转换为 Mermaid 流程图的 Agent 项目，支持 JavaScript、TypeScript、Vue、Java、Python、C/C++ 等 23 种语言/组件格式，并保留节点到源码行号的映射。

## 当前结构

- `frontend/`：Vue 3 + Vite 工作区，集成 Monaco 编辑与 Mermaid 节点定位
- `backend/`：Express + TypeScript 服务，使用 LangChain / LangGraph 生成与追问
- `docs/`：阶段规划与当前架构说明
- `AGENTS.md`：项目协作规则

## 启动前准备

使用 Node.js 22 或更新版本。根目录已启用 npm workspaces，先在根目录安装一次依赖即可：

```bash
npm install
```

首次运行时将 `backend/.env.example` 复制为 `backend/.env`（已有文件保留并补充新变量），填写 `DEEPSEEK_API_KEY` 与 `TYPESAFE_API_KEY`。Jev Choice 由程序直接调用，用于语言识别；DeepSeek 用于生成流程图。检测默认模型 `jev-1.14.0`、超时 5000ms、置信度阈值 0.6，均可通过示例环境变量调整。提交的代码会发送至 TypeSafe 和生成模型服务。

后端统一使用 LangChain `createAgent` 和 LangGraph `StateGraph`；无需再设置 provider。会话默认保存在本地 SQLite，无需 Docker，旧 JSON 会话可按需只读导入。本次接入无需数据库迁移。

## 常用命令

```bash
npm run dev
npm run build
npm run check
```

前端访问 `http://localhost:5173`，后端健康检查为 `http://localhost:3000/api/health`。后端测试使用 `npm run test:backend`；当前前端尚无测试文件。

目前可先专注业务代码 `backend/src/`。自动化测试已统一移至 `backend/tests/` 保留，日常启动和构建无需运行测试。

架构见 [docs/architecture.md](./docs/architecture.md)。
