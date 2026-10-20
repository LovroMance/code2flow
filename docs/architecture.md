# Code2Flow Architecture

当前架构更新于 2026-10-20，已迁移到 LangChain 1.x / LangGraph 1.x 原生 API。

## 总体结构

前端仍采用 Vue 3 / Monaco / Mermaid，`pages` 组织页面，`features` 提供编辑、生成、画图和追问逻辑，`entities` 定义前端契约，`shared` 提供 API 与库初始化。

后端是 Express → controller → service → 原生 StateGraph → LangChain createAgent / ChatOpenAI。所有生成请求走同一状态图，不再按 provider 维护两套驱动。

```mermaid
flowchart TD
    UI[Vue 工作区] -->|POST generate-flow| HTTP[Express controller]
    HTTP --> Service[service · 请求级观测]
    Service --> Graph[LangGraph StateGraph]
    Graph --> Analyze[analyze · 本地识别语言 + createAgent]
    Analyze --> Validate[validate · Zod / Mermaid / mapping]
    Validate -->|失败且未超限，附修正反馈| Analyze
    Validate -->|通过或超限| Done[返回结果或 error]
    Graph --> Explain[explain · 图上下文 + 历史问答]
    Graph <--> SQLite[官方 SqliteSaver]
    Done -->|metadata / mermaid / mappings / done| UI
    UI -->|POST follow-up| HTTP
```

## 关键目录

```text
backend/src/
├─ app/ + routes/ + controllers/   Express 和 HTTP/SSE 协议
├─ services/                      同一执行入口、trace 生命周期
├─ domain/flow/                   Zod schema 与推导类型
├─ prompts/                       生成和追问规则真源
├─ ai/
│  ├─ llms/openai.ts              ChatOpenAI / DeepSeek 兼容端点
│  ├─ chains/code-flow.chain.ts   createAgent + toolStrategy
│  ├─ chains/explain-followup.chain.ts
│  ├─ graph/code-flow.graph.ts    三节点 StateGraph 与条件边
│  ├─ graph/code-flow.state.ts    StateSchema + MessagesValue
│  ├─ graph/checkpointer.ts       官方 SQLite saver 与旧 JSON 只读导入
│  ├─ tools/                     本地语言识别函数
│  ├─ prompts/                   语言专用规则
│  └─ observability/             标准模型/节点回调、trace 与 JSONL sink
├─ eval/                          评估与 A/B
└─ utils/                         结构、映射、Mermaid 与 SSE 工具
```

Vitest / Supertest 测试及模型服务器夹具统一位于 `backend/tests/`，与业务源码分开。业务构建只包含 src；测试通过 `tsconfig.tests.json` 独立检查类型，可按需运行。

## 生成与流式输出

`analyze` 将语言提示和上次校验错误交给 `createAgent`，通过 `toolStrategy` 要求模型提交 `submit_code_flow_result`。框架负责工具绑定、消息合并和 structuredResponse；Zod 继续校验跨字段约束。每个分析尝试只允许一次模型调用，外层图统一管理重试。

标准 LangChain 回调从合并的 AIMessageChunk 获取部分 Mermaid，避免自行维护工具索引和半截 JSON 解析器。Controller 保持原有 SSE 事件形状，部分图源仍是完整快照，最终再发送 mappings 和 done；错误发送 error。

`validate` 检查结构、节点映射、语言一致性和现有 Mermaid 特征规则，并归一化代码行。模型调用或结构异常也会成为图状态错误，进入同一条件边；默认重试 1 次，最多重试 10 次，可用 `CODE2FLOW_MAX_RETRIES` 配置。框架 SDK 的额外模型请求重试已关闭，以免和业务重试相乘。

Mermaid 校验仍沿用当前轻量规则，尚非完整语法解析；本次没有声称提高模型的控制流语义准确率。

## 会话与持久化

原生 `.compile({checkpointer})` 按 `configurable.thread_id` 持久化状态。默认 SQLite 文件为后端工作目录下 `.code2flow/checkpoints/code-flow.sqlite`，可用 `CODE2FLOW_CHECKPOINT_DB` 覆盖，无需 Docker 或额外数据库服务。

未提供 thread_id 的一次性生成和评估不使用默认持久化检查点；测试或调用者仍可显式注入 saver。

生成时清空旧 result、explanation 和问答消息；失败也不恢复旧图。追问从原生 checkpoint 恢复源码和结果，并将问答追加到 MessagesValue。若请求带入的新源码与生成快照不同，明确拒绝并要求重新生成，防止新代码搭配旧图。

仅当 SQLite 中没有线程时，按需读取旧 `CODE2FLOW_CHECKPOINT_FILE` 的 `generate:<threadId>` 记录并通过 `updateState` 导入；原 JSON 保持只读。已有 SQLite 线程的失败结果不会从旧 JSON 复活。

SQLite 当前用于单机或单实例持久化；没有实现同线程并发请求调度、浏览器历史会话列表或检查点清理策略。

## 观测、测试与运行

service 收口成功/失败和采集器落盘；标准模型回调覆盖生成与追问的轮次和供应商 Token 用量，标准节点回调只记录 analyze / validate / explain。原评估与 A/B 模块继续使用相同 service 和 trace 契约。

Node.js 要求 >=22。根目录 `npm run dev` 同时启动双端，`npm run build` 构建双端，`npm run test:backend` 执行后端测试。集成测试使用本地 OpenAI 兼容 HTTP/SSE 服务，实际经过 ChatOpenAI、createAgent、StateGraph、SQLite、Express，不需要真实模型密钥。

详细变更与行数对比见 [重构报告](./langchain-langgraph-refactor/重构报告.md)。
