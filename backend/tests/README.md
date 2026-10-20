# 自动化测试（暂时保留，按需运行）

测试已从 src 统一移入此目录。平时阅读和修改业务代码只需看 `backend/src/`；启动、业务类型检查和业务构建不包含这些测试文件。

```text
tests/
├─ code-flow.graph.test.ts          原生状态图、生成、重试、会话与恢复
├─ flow-generation.trace.test.ts    Supertest HTTP / SSE 与服务观测
├─ observability.test.ts            轨迹和配置指纹
├─ eval.test.ts                     评估规则与 A/B
└─ fixtures/model.fixture.ts        本地模型 HTTP / SSE 测试服务器
```

现有 37 个用例保留，迁移只调整位置和导入。本次迁移没有执行 Vitest / Supertest。

以后需要时，在项目根目录运行 `npm run test:backend`，或在 backend 目录运行 `npm test`。

测试文件有独立的 TypeScript 配置；如只想检查测试代码的类型，可在 backend 目录运行 `npm run typecheck:tests`，不会执行测试用例或调用模型。

根目录 `npm run check` 仍会调用测试脚本；当前暂不测试时可分别使用类型检查、构建和手动联调。
