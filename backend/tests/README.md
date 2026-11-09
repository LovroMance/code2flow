# LangSmith 测试

本目录仅保留 LangSmith 相关测试与必要夹具。业务源码位于 `backend/src/`，业务构建不包含测试文件。

| 文件                            | 覆盖范围                                |
| ------------------------------- | --------------------------------------- |
| `langsmith.test.ts`             | 追踪配置、并行上下文和错误传播          |
| `flow-generation.trace.test.ts` | 真实 Agent 追踪层级、失败传播及重试用量 |
| `fixtures/model.fixture.ts`     | 追踪集成测试使用的本地模型服务器        |

从项目根目录运行：

```bash
npm --prefix backend test
npm --prefix backend run typecheck:tests
```

LangSmith 测试按需手动执行，不接入启动、构建或 Git 提交流程。命令以 `backend/package.json` 为准。

测试使用本地回调与模型夹具，不需要真实模型或 LangSmith 密钥，不上传远程追踪。真实上报、账号权限及供应商用量仍需通过实际调用验证。
