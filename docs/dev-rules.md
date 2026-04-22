# Code2Flow Dev Rules

## 代码方向

- 保持实现简单直接
- 阶段一优先闭环，不提前做阶段二复杂抽象
- 优先写清晰代码，不追求过早封装

## Prompt 规则

- 只使用 Vue / JavaScript / TypeScript 示例
- 不使用 React 相关术语
- 输出必须是严格 JSON
- 不暴露 chain-of-thought

## 前端规则

- 页面先保持双栏布局
- Monaco 和 Mermaid 分开封装
- 状态逻辑优先放在 composables
- 节点联动必须依赖稳定的 `nodeId`

## 后端规则

- Prompt 集中放在 `backend/src/prompts.ts`
- Schema 集中放在 `backend/src/types.ts`
- 进入前端前先做 Zod 校验
- Mermaid 校验失败时要有重试或错误返回机制

## 目录规则

- 项目说明与规划放在 `docs/`
- 新增上下文文档优先补到 `docs/`
- 不要把大段 Prompt 写散在多个文件里

## 脚本规则

- 尽量从根目录运行命令
- 优先使用统一脚本：
  - `npm run dev`
  - `npm run build`
  - `npm run check`

## 新会话协作规则

- 开新会话时先读：
  - `docs/context.md`
  - `AGENTS.md`
  - `docs/阶段一.md`
  - `docs/prompt-spec.md`
- 如果做实现，先确认当前任务属于阶段一还是阶段二
- 如果改 Prompt 或 schema，必须同步检查相关文档是否需要更新
