# LangSmith 执行追踪

本项目通过 LangChain / LangGraph 原生追踪将执行数据发送到 LangSmith。单文件生成、多文件生成和追问均有独立请求级 Trace；SSE、模型服务、重试策略和 SQLite saver 沿用现有实现，无需购买 LangSmith 部署服务。

## 填写配置

打开 [LangSmith](https://smith.langchain.com)，登录或注册账号，选择 workspace，在设置中创建 API Key。界面名称可能随账号版本变化，通常位于 Settings → API Keys。不要将密钥发到聊天或提交到 Git。

在本地 `backend/.env` 中填写以下配置，保留已有的密钥和其他配置：

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=code2flow-dev
LANGSMITH_ENDPOINT=
LANGSMITH_WORKSPACE_ID=
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

- `LANGSMITH_API_KEY`：必填，你在 LangSmith 创建的密钥；留空时启动程序会关闭远程追踪，分析功能仍可运行。
- `LANGSMITH_PROJECT`：已有默认名称，也可自行修改；首次上报需要账号有相应项目创建权限。
- `LANGSMITH_ENDPOINT`：美国区域可留空，默认 `https://api.smith.langchain.com`；其他区域填写账号对应的 API 地址。例如欧洲区域为 `https://eu.api.smith.langchain.com`。这里不是网页地址。
- `LANGSMITH_WORKSPACE_ID`：仅当 API Key 关联多个 workspace 或账号要求时填写；其他情况留空。
- `LANGCHAIN_CALLBACKS_BACKGROUND`：当前是常驻 Node.js 服务，使用 `true` 在后台上传。关闭进程前留出上传时间；强制终止可能丢失最后的记录。迁移到短生命周期函数时需重新评估上传等待方式。

配置后重启后端。在根目录使用现有命令 `npm run dev`，或只重启后端 `npm run dev:backend`。已有 DeepSeek / Jev 密钥仍然负责模型调用，与 LangSmith 密钥相互独立。

**启用完整追踪后，Graph 输入状态、模型消息、工具参数和响应可能包含用户源码、问题和生成结果，并会上传到指定的 LangSmith 项目。**这是远程观测的显式开关，默认 `false`；本地 console 只保留启动、配置异常、降级及失败摘要。不要上传不适合保存在该项目的数据，也不要在待分析源码中放真实密钥。模型内部未返回的推理过程无法通过追踪还原。

## 查看一次执行

1. 启动前后端，在 Code2Flow 输入一小段可上传的测试代码，点击“生成流程图”。
2. 打开 LangSmith 的 Tracing / Tracing Projects，选择 `code2flow-dev`。部分新版 workspace 将项目放在 Agents / Environments 下，以相同项目名称进入对应环境。
3. 等待后台上传完成并刷新，打开最新记录。多文件分析根记录为 `code2flow.multifile`，旧单文件为 `code2flow.generate`，追问为 `code2flow.multifile-followup` 或 `code2flow.followup`。
4. 在执行树中展开 Graph 节点、`code2flow.analysis-task`、角色 Agent、模型和工具调用，点击查看 Inputs / Outputs、时间、状态、模型 usage。
5. 通过 `session_id`、`snapshot_id`、`analysis_id`、`task_id` / `taskId`、`attempt` 等元数据识别会话、源码快照、并行任务和第几次尝试；不同层级具有与自身相关的字段。

自定义步骤包括：

| 步骤                                                   | 可查看内容                                       |
| ------------------------------------------------------ | ------------------------------------------------ |
| `code2flow.detect-language`                            | 检测源码样本、语言、置信度和降级状态             |
| `code2flow.jev-choice`                                 | Jev 实际请求和响应，包括供应商返回的 usage       |
| `code2flow.prepare-retrieval`                          | 分块数量、可用向量数量、Embedding 调用和降级信息 |
| `code2flow.search-code`                                | 查询、候选片段、排名和召回来源                   |
| `code2flow.analysis-task`                              | 任务身份、尝试次数、校验反馈和任务结果           |
| `code2flow.index-cache` / `code2flow.generation-cache` | 缓存键、是否命中和复用的结果                     |
| 角色 Agent / 模型 / 源码工具                           | 消息、工具定义与参数、返回内容及模型 usage       |

缓存命中时没有对应模型调用，这是正常情况。并行分支共享一个根 Trace，各自保留任务标识。校验失败后允许重试的任务可能正常返回 `{ error, fatal, attempts }`；因此子步骤未显示红色异常不代表通过业务校验，应查看 Outputs 和下一次任务的校验反馈。重试耗尽、取消或终止异常会使请求级 Trace 失败。

## 查看汇总面板和费用

进入项目的 Dashboard，或 Monitoring 中该项目对应的面板，可以查看请求量、延迟、错误率、模型调用、token 和估算费用。先使用内置面板；按 `operation`、`role` 等字段筛选或分组可区分生成、追问及不同模型角色，具体图表能力以账号界面为准。

模型 token 以供应商回报为准，流式调用已请求 usage。供应商没有返回时无法保证完整统计，不应将缺失视为零。嵌套父节点可能已聚合子调用用量，不要把整棵树每层的总量再次相加。

DeepSeek 兼容协议通过模型元数据标记 `ls_provider=deepseek` 和实际模型名。若 token 已出现但费用缺失或不准确，在 LangSmith 设置中的 Model Pricing 核对模型、供应商、输入输出及缓存价格；价格按实际供应商配置。自定义网关若使用其他实际供应商，还需要同步调整模型元数据。建议在首个正式请求前完成定价，历史 Trace 的价格不会因后续修改自动回填。

Jev 原始 usage 和 Embedding 准备统计可在对应步骤 Outputs 查看，本次没有将它们转换成 LangSmith 的 LLM 计费记录，因此平台总 token / 费用不保证包含它们，也不包含你的服务器资源费。追踪服务自身的套餐费用与模型推理费用独立。

## 没有记录时

依次检查后端是否已重启、启动信息是否显示远程追踪启用、API Key / workspace / 区域是否匹配、项目名称和时间筛选是否正确，以及后端能否访问对应 API。密钥空缺或端点格式错误会在启动时提示并关闭上传。网络或鉴权上报错误通常出现在 SDK 日志中，不通过修改业务重试来解决。

追踪统一使用 LangSmith，旧本地 JSONL、用量控制台及离线评估工具已移除。停止远程追踪需要设置 `LANGSMITH_TRACING=false` 后重启；已有会话和源码快照不受影响。

## 开发验证

使用仓库已有脚本：

```bash
npm run build:backend
npm --prefix backend run typecheck:tests
npm --prefix backend test
```

自动化测试使用本地回调验证 Graph 和并行步骤的层级、元数据、既有回调兼容及失败传播，不需要真实 LangSmith Key。真实上报、账号权限、供应商 usage 和价格仍需填写配置后，用一次真实生成和追问验证。

参考：[LangChain 接入](https://docs.langchain.com/langsmith/trace-with-langchain)、[监控面板](https://docs.langchain.com/langsmith/dashboards)、[费用统计](https://docs.langchain.com/langsmith/cost-tracking)。
