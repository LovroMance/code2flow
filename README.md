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

后端从 `backend/.env` 读取本地配置，已有文件保留。首次配置时填写 `DEEPSEEK_API_KEY` 与 `TYPESAFE_API_KEY`；多文件分析还需设置 `CODE2FLOW_MODEL_CONTEXT_TOKENS` 为供应商实际上下文窗口。Jev Choice 由程序直接调用，用于语言识别；DeepSeek 用于生成流程图。检测默认模型 `jev-1.14.0`、超时 5000ms、置信度阈值 0.6，分别通过 `TYPESAFE_DEFAULT_MODEL`、`CODE2FLOW_LANGUAGE_TIMEOUT_MS`、`CODE2FLOW_LANGUAGE_MIN_CONFIDENCE` 调整。提交的代码会发送至 TypeSafe 和生成模型服务。本地环境文件不提交到 Git。

后端统一使用 LangChain `createAgent` 和 LangGraph `StateGraph`；无需再设置 provider。有会话 ID 的分析默认保存在本地 SQLite，无需 Docker，业务表按需创建。旧 JSON 会话可在追问恢复时按需只读导入。

## 多文件切块

调试预览和正式分析共用 Tree-sitter 切块。支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Ruby、PHP 和 Bash 的语法边界。每块由连续整行组成，优先保留完整的顶层语法单元。Java 类超出目标时，可以沿类成员边界切分，保留完整方法。相邻块无重叠，源码定位使用首尾都包含的原始行号。

`CODE2FLOW_MULTI_CHUNK_TARGET_CHARS` 默认是 6000，按 UTF-16 计数，是打包目标。完整语法单元可以超出目标单独成块。模型上下文和输出限制仍按实际请求校验。旧的 `CODE2FLOW_MULTI_CHUNK_LINES` 和 `CODE2FLOW_MULTI_CHUNK_CHARS` 已停用。

文件没有可用的语法切点时，整份作为一块送入索引，并受模型上下文限制。

多文件分析不限制整次任务的累计输入、输出 Token，模型请求也不再发送单次输出 Token 上限。旧的 `CODE2FLOW_MULTI_MAX_INPUT_TOKENS`、`CODE2FLOW_MULTI_MAX_OUTPUT_TOKENS`、`CODE2FLOW_MODEL_MAX_OUTPUT_TOKENS` 配置不再生效；实际输出长度由模型服务决定，服务返回长度截断时仍终止任务并报错。本地上下文窗口通过 `CODE2FLOW_MODEL_CONTEXT_TOKENS` 设置，当前本机配置为 500000 Token；调整该配置不会改变供应商实际支持的上下文窗口。调用总次数、并发、超时及文件限制继续保留。

## 常用命令

```bash
npm run dev
npm run build
```

前端访问 `http://localhost:5175`，后端健康检查为 `http://localhost:3000/api/health`。根目录仅保留整体及前后端独立的开发、构建命令；不配置格式校验或提交钩子。

业务代码位于 `backend/src/` 和 `frontend/src/`，产品与设计文档位于 `docs/`。`backend/tests/` 仅保留 LangSmith 配置与追踪测试及其模型夹具，需要时通过 `npm --prefix backend test` 手动执行。TypeScript 编译配置保留，业务变更按影响范围进行编译及实际流程验证。

当前使用范围为本机单用户。可选接入 LangSmith 查看执行树、输入输出、耗时和用量，默认关闭远程上传；配置步骤和看板说明见 [LangSmith 执行追踪](./docs/langsmith.md)。完整 Mermaid 校验、生成 SVG 安全处理、鉴权和多实例协调尚未完善，具体见架构文档的已知实现差距。

- [架构说明](./docs/architecture.md)：分层、生成与追问、协议、存储及实现边界。
- [产品范围与验收目标](./docs/product.md)：当前能力、验收场景和候选改进方向。
