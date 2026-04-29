# Code2Flow LangGraph 接入规划

## 目标

这份文档用于规划 Code2Flow 后端从“以 LangChain 单轮调用为主”逐步升级到“以 LangGraph 状态编排为主”的实现路径。

规划原则：

- 尽量复用现有 LangChain 代码，而不是推翻重写
- 优先服务阶段一目标：稳定生成 Mermaid 与 mappings
- 为阶段二目标预留空间：多轮追问、状态持久化、解释能力
- 先把流程编排做好，再补充更多 tool 和 agent 能力

## 当前现状

结合当前仓库实现，后端已经具备以下基础：

- `backend/src/ai/chains/code-flow.chain.ts`
  - 已实现基于 LangChain 的模型调用
  - 已接入 tool calling
  - 已支持流式提取 partial Mermaid
- `backend/src/ai/tools/`
  - 已有 `detect_language`
  - 已有 `submit_code_flow_result`
- `backend/src/utils/`
  - 已有 Mermaid 校验
  - 已有结构化结果校验
  - 已有 mapping 归一化
- `backend/src/ai/graph/`
  - 已有 `analyze -> validate -> retry` 的最小骨架

当前 graph 存在的主要问题：

- state 过薄，只包含 `code`、`result`、`error`、`retryCount`
- graph 还没有真正接管“语言检测、分析、校验、归一化”的完整流程
- `analyzeNode` 仍然直接调用整段 LangChain 主流程，职责边界不够清晰
- `validateNode` 目前只校验 Mermaid，没有把 schema 校验、mapping 校验一起纳入
- 还没有为 `thread_id`、追问解释、checkpointer 做状态设计

## 总体设计思路

推荐采用“保留 LangChain 能力层，新增 LangGraph 编排层”的结构。

职责划分：

- LangChain 负责：
  - 模型实例
  - prompt 组装
  - tool calling
  - structured output
  - 局部流式输出
- LangGraph 负责：
  - state 管理
  - 节点拆分
  - 条件跳转
  - 重试策略
  - 会话记忆
  - 追问分流

一句话概括：

不是“把 LangChain 删掉换成 LangGraph”，而是“把原来写在大函数里的流程控制，迁移到 LangGraph”。

## 推荐目录结构

建议在现有目录基础上扩展到下面这个形态：

```text
backend/src/ai/
├── chains/
│   └── code-flow.chain.ts
├── graph/
│   ├── code-flow.graph.ts
│   ├── code-flow.state.ts
│   ├── code-flow.types.ts
│   ├── nodes/
│   │   ├── detect-language.node.ts
│   │   ├── analyze-flow.node.ts
│   │   ├── validate-flow.node.ts
│   │   ├── normalize-flow.node.ts
│   │   ├── explain-followup.node.ts
│   │   └── retry.node.ts
│   └── routers/
│       └── code-flow.router.ts
├── llms/
├── prompts/
└── tools/
```

说明：

- `chains/` 保留为底层能力层
- `graph/` 负责真正的 agent 编排
- `nodes/` 只做单一职责节点
- `routers/` 专门放条件跳转逻辑，避免 graph 文件变得臃肿

## 推荐 State 设计

建议先把 state 升级成可覆盖阶段一和阶段二的统一结构。

参考设计：

```ts
import type { FlowGenerationResult } from '../../domain/flow/types'
import type { SupportedLanguage } from '../../domain/flow/language'

export type CodeFlowGraphMode = 'generate' | 'followup'

export interface CodeFlowGraphState {
  mode: CodeFlowGraphMode
  threadId?: string

  code: string
  question?: string

  detectedLanguage?: SupportedLanguage
  result?: FlowGenerationResult
  explanation?: string

  retryCount: number
  maxRetries: number

  error?: string
  validationErrors?: string[]
}
```

字段说明：

- `mode`
  - `generate` 表示生成流程图
  - `followup` 表示追问解释
- `threadId`
  - 预留给阶段二会话持久化
- `question`
  - 追问模式下使用
- `detectedLanguage`
  - 让 graph 明确持有语言判断结果
- `result`
  - 保存流程图生成结果
- `explanation`
  - 保存追问解释结果
- `validationErrors`
  - 让 retry 不是盲重试，而是带反馈重试

## 节点设计

### 1. `detect-language.node.ts`

职责：

- 对输入 `code` 做语言识别
- 写回 `detectedLanguage`

优先复用：

- `backend/src/ai/tools/detect-language.tool.ts` 中的 `runDetectLanguage`

建议：

- 在 graph 主流程里，语言检测优先用程序节点完成
- 不强制让模型再调用 `detect_language` tool

原因：

- 这是确定性逻辑
- 没必要消耗一次模型调用轮次
- graph 先拿到语言，后续 prompt 可更稳定

### 2. `analyze-flow.node.ts`

职责：

- 基于 `code + detectedLanguage` 生成初版 `result`
- 如果是 SSE 请求，继续支持 partial Mermaid 回调

优先复用：

- `backend/src/ai/chains/code-flow.chain.ts`
- `backend/src/ai/llms/openai.ts`
- `backend/src/ai/prompts/*`
- `backend/src/ai/tools/submit-code-flow-result.tool.ts`

建议改造：

把 `code-flow.chain.ts` 从“完整流程入口”拆成更可复用的底层函数，例如：

```ts
generateCodeFlowDraft(params: {
  code: string
  detectedLanguage?: SupportedLanguage
  onPartialMermaid?: (mermaid: string) => void
}): Promise<FlowGenerationResult>
```

这样 graph 的 `analyze-flow` 节点直接调底层函数即可。

### 3. `validate-flow.node.ts`

职责：

- 校验 schema
- 校验 Mermaid
- 校验 mappings 与 Mermaid 节点一致
- 记录错误并供 retry 使用

优先复用：

- `parseFlowGenerationResult`
- `validateNodeMappings`
- `validateMermaid`

建议：

- 不要只校验 Mermaid
- 要把“结构对不对”和“引用对不对”一起纳入

### 4. `normalize-flow.node.ts`

职责：

- 调整 lineStart / lineEnd 到真实可执行代码行
- 输出最终稳定结果

优先复用：

- `normalizeFlowResultAgainstCode`

### 5. `retry.node.ts`

职责：

- 增加 `retryCount`
- 清理本轮临时错误
- 需要时把 `validationErrors` 组织成下一轮 prompt 的反馈

建议：

- retry 不只是计数
- 后续可以扩展为“将失败原因注入到下一轮分析 prompt”

### 6. `explain-followup.node.ts`

职责：

- 基于历史 `result + code + question` 生成解释型回答

这个节点属于阶段二，但建议现在就把目录和 state 预留好。

## 路由设计

建议增加一个 router 文件，集中处理 graph 条件分支。

推荐包含两个路由函数：

### `routeByMode`

职责：

- `generate` 走流程图生成链路
- `followup` 走解释链路

### `routeAfterValidation`

职责：

- 无错误且有结果：进入 `normalize-flow`
- 有错误且可重试：进入 `retry`
- 有错误且超出重试次数：结束并抛错

## Graph 主流程

### 阶段一推荐流程

```text
START
 -> detectLanguage
 -> analyzeFlow
 -> validateFlow
    -> success -> normalizeFlow -> END
    -> fail and canRetry -> retry -> analyzeFlow
    -> fail and noRetry -> END(error)
```

### 阶段二扩展流程

```text
START
 -> routeByMode
    -> generate -> detectLanguage -> analyzeFlow -> validateFlow -> normalizeFlow -> END
    -> followup -> explainFollowup -> END
```

## 对现有文件的改造建议

### 保持不动或只做小修的文件

- `backend/src/ai/llms/openai.ts`
- `backend/src/utils/mermaidValidator.ts`
- `backend/src/utils/flowResultValidator.ts`
- `backend/src/utils/mappingNormalizer.ts`
- `backend/src/domain/flow/schema.ts`

这些文件已经是比较清晰的底层能力，不建议为了接 LangGraph 而重写。

### 重点改造的文件

#### `backend/src/ai/chains/code-flow.chain.ts`

当前问题：

- 同时承担了模型调用、tool loop、流程控制、最终结果返回多个职责

建议改造方向：

- 抽出底层分析函数
- 保留 partial Mermaid 流式能力
- 让 graph 节点可以复用，而不是只能整段调用

推荐拆分目标：

- `buildCodeFlowModel()`
- `generateCodeFlowDraft()`
- `streamToolCallingRound()`

#### `backend/src/ai/graph/code-flow.state.ts`

当前只有：

- `code`
- `result`
- `error`
- `retryCount`

建议按本文 State 设计升级。

#### `backend/src/ai/graph/code-flow.graph.ts`

当前还是手动 while-loop 风格。

建议目标：

- 让 graph 文件只负责连接节点和路由
- 节点逻辑下沉到 `nodes/`
- 条件跳转下沉到 `routers/`

#### `backend/src/agents/code-flow.agent.ts`

建议继续保留双 provider：

- `langchain`
- `graph`

推荐迁移顺序：

- 先保留默认 `langchain`
- graph 跑稳后，再把默认 provider 切到 `graph`

这样回退成本最低。

## 分阶段实施计划

### 第一阶段：把 Graph 基础打稳

目标：

- 不改接口协议
- 不动前端
- 先让 graph 真正接管阶段一主流程

任务：

1. 扩充 `code-flow.state.ts`
2. 新增 `detect-language.node.ts`
3. 把 `validate.node.ts` 升级成 `validate-flow.node.ts`
4. 新增 `normalize-flow.node.ts`
5. 重写 `code-flow.graph.ts` 的节点连接逻辑
6. 为 graph 输出加清晰日志

验收标准：

- graph provider 能独立生成有效结果
- schema、Mermaid、mapping 校验都在 graph 流程里生效
- 重试逻辑仍然可用

### 第二阶段：重构 Chain，变成可复用能力层

目标：

- 让 `code-flow.chain.ts` 不再是“入口黑盒”
- 让 graph 节点复用更自然

任务：

1. 抽出 `buildCodeFlowModel`
2. 抽出 `generateCodeFlowDraft`
3. 保留 `streamToolCallingRound`
4. 让 `analyze-flow.node.ts` 直接调用抽出的底层函数

验收标准：

- graph 节点不需要依赖完整的“外部入口函数”
- chain 文件职责更聚焦
- 现有流式 partial Mermaid 不回退

### 第三阶段：把 `thread_id` 真正接入 state

目标：

- 让接口里的 `thread_id` 不再只是占位字段

任务：

1. state 中增加 `threadId`
2. controller / service 将 `thread_id` 透传到 graph
3. 预留 checkpointer 接口位置

验收标准：

- graph 能感知线程标识
- 后续引入 checkpoint 时不需要再大改接口

### 第四阶段：增加追问解释能力

目标：

- 支持“为什么这么画”的 follow-up 问答

任务：

1. 新增 `followup` mode
2. 新增 `explain-followup.node.ts`
3. 新增追问接口或扩展现有接口
4. 让解释能力复用上次 `result`

验收标准：

- 能基于上次分析结果回答问题
- 不需要每次都重新全量分析代码

### 第五阶段：接入 Checkpointer

目标：

- 让阶段二会话真正持久化

任务：

1. 选择轻量持久化方案
2. 保存 `code`、`result`、`question`、`explanation`
3. 基于 `threadId` 恢复上下文

验收标准：

- 多轮会话能够延续
- 追问不丢上下文

## 推荐优先级

如果你只想先做最值的一段，建议按下面顺序推进：

1. 升级 graph state
2. 补齐 `detect -> analyze -> validate -> normalize` 节点链
3. 重构 chain 底层函数，服务 graph 复用
4. 接入 `thread_id`
5. 新增 follow-up 节点
6. 最后再上 checkpointer

这个顺序的优点：

- 每一步都能独立验收
- 不会一下子把现有后端推翻
- 每一步都更贴近阶段一和阶段二目标

## 暂时不建议优先做的事

当前阶段不建议优先投入的方向：

- 堆很多新的外部 tools
- 做通用型自由 agent
- 过早上复杂 RAG
- 在阶段一就引入太多开放式多轮逻辑

原因：

- Code2Flow 的核心任务是高约束、强结构化、可验证
- 这类任务更适合稳定 graph，而不是先追求“很像 agent 的自由感”

## 测试建议

LangGraph 接入后，建议补这些测试：

- state 路由测试
- validate 节点测试
- retry 条件测试
- normalize 节点测试
- graph provider 集成测试
- follow-up 节点测试（阶段二）

优先覆盖：

- Mermaid 非法时能重试
- mappings 节点缺失时能失败
- lineStart / lineEnd 归一化正常
- graph 成功和失败分支都可预测

## 完成标志

当出现以下结果时，可以认为 LangGraph 已经真正接入成功：

- 主流程默认由 graph provider 承担
- 现有 LangChain 代码变成 graph 的可复用底层能力
- 阶段一的生成、校验、重试、流式逻辑仍然稳定
- `thread_id` 能被 graph state 感知
- 阶段二追问能力具备清晰扩展路径

## 结论

对 Code2Flow 来说，LangGraph 不是替代现有 LangChain 代码，而是把你已经写出来的模型调用、tools、校验逻辑组织得更清晰、更可扩展。

最合适的路线不是“重写”，而是：

1. 保留底层 LangChain 能力
2. 迁移流程控制到 LangGraph
3. 先稳定阶段一 graph
4. 再接阶段二会话和追问

这条路线风险低、复用高，也最符合当前仓库的实现状态。
