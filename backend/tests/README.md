# 后端自动化测试

测试统一放在 `backend/tests/`，业务源码位于 `backend/src/`。业务构建不包含测试文件；测试类型通过 `backend/tsconfig.tests.json` 单独检查。

| 文件                            | 覆盖范围                                 |
| ------------------------------- | ---------------------------------------- |
| `code-flow.graph.test.ts`       | 原生状态图、生成、重试、追问与检查点恢复 |
| `flow-generation.trace.test.ts` | HTTP / SSE 与服务观测集成                |
| `session-management.test.ts`    | 会话目录、草稿、恢复、删除与并发互斥     |
| `number-source-lines.test.ts`   | 源码原始行号编号                         |
| `observability.test.ts`         | 轨迹采集和配置指纹                       |
| `usage.test.ts`                 | 用量日志读取、过滤和响应                 |
| `eval.test.ts`                  | 评估规则与报告对比                       |
| `fixtures/model.fixture.ts`     | 本地 OpenAI 兼容 HTTP / SSE 模型服务器   |

从项目根目录运行：

```bash
npm run test:backend
npm --prefix backend run typecheck:tests
```

根目录 `npm run check` 执行两端 lint、业务类型检查和测试；不包含后端独立的 `typecheck:tests`。其他命令以各级 `package.json` 为准。

自动化测试使用本地夹具或 mock，不需要真实模型密钥。它们验证框架集成和业务行为，不能证明真实 Jev 识别率、生成语义准确性或浏览器渲染效果。`backend/src/eval/` 的模型跑批需要单独配置环境并调用外部服务。

前端测试位于 `frontend/tests/`，可通过根目录 `npm run test:frontend` 执行。涉及 Monaco、Mermaid 或页面交互时，还需按变更范围进行浏览器验证。
