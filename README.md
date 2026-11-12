# Code2Flow

把源码（单文件或多文件）转成 Mermaid 流程图，并保留「图节点 ↔ 源码行号」映射：点击图中节点可跳回编辑器对应行，也可基于同一份源码快照追问。编辑器支持 23 种语言/组件格式。

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + Vite + Monaco + Mermaid；手写路由（`App.vue`），无 vue-router / Pinia，按 `app / pages / features / entities / shared` 分层 |
| 后端 | Express + TypeScript + LangChain / LangGraph（`StateGraph`） |
| 存储 | 本地 SQLite，无独立数据库服务 |
| 模型 | TypeSafe SDK 识别语言，OpenAI 兼容接口生成流程图 |

> 定位为本机单用户工具，**没有鉴权**。上传的源码会发送到第三方模型服务，请先确认合规再使用。

## 目录

| 路径 | 内容 |
| --- | --- |
| `frontend/src/` | `app`、`pages`、`features`、`entities`、`shared` |
| `backend/src/` | `index.ts` → `app` → `routes` → `controllers` → `services` → `ai`(graph/chains/tools) → `repositories` → `domain` / `utils` |
| `docs/` | 设计决策记录（`设计要点.md`），不是架构文档 |
| `测试功能代码/` | 手动调试用的样例源码 |
| `测评集/` | LangSmith 回归数据集（JSONL） |
| `backend/.env` | 本地配置，已 gitignore |
| `backend/.code2flow/` | 运行时 SQLite 检查点、追踪与评测产物，已 gitignore |

## 启动

要求 Node.js **>= 22**（`backend/package.json` 的 `engines`）。根目录已启用 npm workspaces，装一次即可。

```bash
npm install
npm run dev
```

| 地址 | 说明 |
| --- | --- |
| `http://localhost:5175` | 前端，`/api` 由 Vite 代理到 3000 |
| `http://localhost:5175/evaluations` | 评测页（需 LangSmith 配置） |
| `http://localhost:3000/api/health` | 后端健康检查 |

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 前后端一起启动（`concurrently`） |
| `npm run dev:frontend` / `npm run dev:backend` | 分别启动 |
| `npm run build` | 前端 `vue-tsc + vite build`，后端 `tsc` |
| `npm --prefix backend test` | 手动运行 `backend/tests/`（vitest） |

项目不配置 lint、格式化或提交钩子；验证靠 `npm run build` 加手动跑实际流程，约定见 `docs/设计要点.md`。

## 配置

后端在 `backend/src/index.ts` 用 `dotenv` 读取 `backend/.env`。**标为「必填」的变量在代码里没有默认值，缺失时生成接口会在配置校验处直接报错**；迁移环境时按清单补齐。该文件已 gitignore，不要提交或写入密钥。

| 分组 | 变量 | 默认值 |
| --- | --- | --- |
| 生成模型（必填） | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | 无 |
| 语言识别（必填） | `TYPESAFE_API_KEY`、`TYPESAFE_DEFAULT_MODEL`、`CODE2FLOW_LANGUAGE_TIMEOUT_MS`、`CODE2FLOW_LANGUAGE_MIN_CONFIDENCE` | 无 |
| 运行预算（必填） | `CODE2FLOW_MODEL_CONTEXT_TOKENS`、`CODE2FLOW_MULTI_TIMEOUT_MS`、`CODE2FLOW_MULTI_MAX_FILES`、`CODE2FLOW_MULTI_MAX_TOTAL_BYTES`、`CODE2FLOW_MULTI_CONCURRENCY`、`CODE2FLOW_MULTI_MAX_MODEL_CALLS` | 无 |
| 服务（必填） | `PORT` | 无 |
| 可调 | `CODE2FLOW_MULTI_CHUNK_TARGET_CHARS` | `6000` |
| 可调 | `CODE2FLOW_MAX_RETRIES` | `1` |
| 可调 | `DEEPSEEK_TEMPERATURE` | `0` |
| 可调 | `CODE2FLOW_CHECKPOINT_DB` | `.code2flow/checkpoints/code-flow.sqlite` |
| 可选追踪 | `LANGSMITH_TRACING`（值为 `true` 才启用）、`LANGSMITH_API_KEY`、`LANGSMITH_ENDPOINT`、`LANGSMITH_PROJECT`、`LANGSMITH_WORKSPACE_ID` | 关闭 |

配置解析集中在 `services/multifile-config.ts`、`ai/llms/openai.ts`、`ai/tools/detect-language.tool.ts`（均在 `backend/src/` 下）。
