# Code2Flow

Code2Flow 是一个将主流编程语言代码转换为 Mermaid 流程图的 Agent 项目，支持 JavaScript、TypeScript、Vue、Java、Python、C/C++ 等 23 种语言/组件格式，并保留节点到源码行号的映射。

## 当前结构

- `frontend/`：Vue 3 + Vite 工作区，集成 Monaco 编辑与 Mermaid 节点定位
- `backend/`：Express + TypeScript 服务，使用 LangChain / LangGraph 生成与追问
- `docs/`：当前架构、产品范围与验收目标
- `AGENTS.md`：项目协作规则

## 启动前准备

使用 Node.js 22 或更新版本。根目录已启用 npm workspaces，先在根目录安装一次依赖即可：

```bash
npm install
```

首次运行时将 `backend/.env.example` 复制为 `backend/.env`（已有文件保留并补充新变量），填写 `DEEPSEEK_API_KEY` 与 `TYPESAFE_API_KEY`。Jev Choice 由程序直接调用，用于语言识别；DeepSeek 用于生成流程图。检测默认模型 `jev-1.14.0`、超时 5000ms、置信度阈值 0.6，均可通过示例环境变量调整。提交的代码会发送至 TypeSafe 和生成模型服务。

后端统一使用 LangChain `createAgent` 和 LangGraph `StateGraph`；无需再设置 provider。有会话 ID 的分析默认保存在本地 SQLite，无需 Docker，业务表按需创建。旧 JSON 会话可在追问恢复时按需只读导入。

## 常用命令

```bash
npm run dev
npm run build
npm run check
```

前端访问 `http://localhost:5173`，后端健康检查为 `http://localhost:3000/api/health`。前后端测试分别使用 `npm run test:frontend` 和 `npm run test:backend`；后端测试代码类型检查使用 `npm --prefix backend run typecheck:tests`。

后端业务代码位于 `backend/src/`，测试位于 `backend/tests/`；前端测试位于 `frontend/tests/`。启动和构建不会自动执行测试，修改后应按影响范围运行检查。模型评估脚本会调用外部服务，与无需真实密钥的自动化测试不同。

当前使用范围为本机单用户。生成链仍有输出源码和原始模型结果的调试日志；完整 Mermaid 校验、生成 SVG 安全处理、鉴权和多实例协调尚未完善，具体见架构文档的已知实现差距。

- [架构说明](./docs/architecture.md)：分层、生成与追问、协议、存储及实现边界。
- [产品范围与验收目标](./docs/product.md)：当前能力、验收场景和候选改进方向。
