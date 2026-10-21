# Code2Flow 开发约束

## 适用范围

- 本文件只维护开发约束，不记录产品定位、阶段规划、功能清单或实现快照。
- 优先沿用现有技术栈、目录分层和代码风格；采用简单、明确的实现，避免无需求支撑的抽象和依赖。
- 文档和注释使用中文，文件使用 UTF-8 编码。

## 代码与契约依据

- 架构与分层说明：`docs/architecture.md`；修改架构时同步更新。
- 生成与追问 Prompt：`backend/src/prompts/code-flow.prompt.ts`。
- 语言识别 Prompt：`backend/src/prompts/detect-language.prompt.ts`。
- 语言专用生成规则：`backend/src/ai/prompts/code-flow-language.system.prompt.ts`。
- 后端契约：`backend/src/domain/flow/schema.ts`、`types.ts`、`language.ts`。
- 前端契约与语言配置：`frontend/src/entities/flow/model/`。
- 运行命令以根目录及前后端的 `package.json` 为准，不另行维护脚本规划。

## 后端与模型调用

- 保持 controller 处理 HTTP/SSE、service 组织调用、graph 编排状态、chain 封装模型调用的职责边界。
- 使用 LangGraph 原生 `StateGraph` 和框架 checkpointer，不另建手写状态机或 provider 双通道。
- 重试由 graph 统一控制，并向下一次生成传递校验反馈；避免叠加模型 SDK 重试导致请求次数膨胀。
- 语言识别由程序直接调用 Jev，生成重试复用检测结果；生成模型不得覆盖检测语言，无法确定时保留 `unknown`。
- 生成使用 LangChain `createAgent` 与 `toolStrategy` 提交结构化结果，字段以 Zod schema 为准；追问按独立 Prompt 返回解释，不强制使用生成结果格式。
- 对外返回前使用 Zod 校验结构化模型输出，并校验 Mermaid、节点映射和源码范围。
- 不在用户可见输出中暴露模型内部推理过程。
- 保持现有 SSE 事件名称、载荷和结束/错误语义兼容；变更契约时同步修改前后端。
- 会话持久化使用框架 saver；新生成清空旧结果和问答，追问须基于同一源码快照，禁止将新源码与旧图混用。
- 密钥通过环境变量配置，不提交密钥、运行时会话文件，日志不记录密钥或用户源码。

## Mermaid 与行号映射

- Mermaid 必须有效且可渲染；修改归一化或校验逻辑时保留对既有输出的兼容。
- 图中节点与 mappings 一一对应，`nodeId` 完全一致；采用 `n_<kind>_<lineStart>`，同一行多个节点使用后缀区分。
- 映射行号必须对应原始源码的有效范围，不能因展示或预处理偏移。
- 修改语言支持时同步检查后端语言枚举、识别规则、前端语言选项及 Monaco 映射，不将输入范围硬编码为仅 JS/TS/Vue。

## 前端

- 使用 Vue 3 与 TypeScript，遵循 Composition API 和现有组件写法，不引入 React 组件或 Hook。
- 页面组织放在 `pages/`，功能逻辑放在 `features/`，契约放在 `entities/`，通用 API 和库初始化放在 `shared/`。
- Monaco 和 Mermaid 集成保持独立组件；有状态的集成逻辑优先使用 composable。
- 修改渲染或映射时保持节点点击后滚动并高亮对应代码行的联动正确。
- 普通请求沿用 axios，SSE 沿用 fetch；流式 UI 应明确展示加载、完成和错误状态。

## 注释与验证

- TypeScript 保持严格类型，跨边界数据先校验再使用。
- 职责不明显的模块或函数添加简短说明；非直观的校验、路由、重试、归一化和流式处理分支说明原因，不逐行复述语法。
- 改动保持聚焦，按可独立验证的闭环推进，不夹带无关重构。
- 后端测试放在 `backend/tests/`；修改 schema、Mermaid、SSE、映射、重试或会话行为时补充或更新相关测试。
- 按改动范围运行类型检查、lint 和相关测试；涉及测试代码时检查 `typecheck:tests`。纯文档修改检查引用与差异即可。
- 交付时说明改动、验证结果及未验证的部分；新增环境变量同步更新 `backend/.env.example`。
