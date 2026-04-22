# Code2Flow Current Status

## 已完成

- 将原始 `work.md` 拆分为阶段文档
- 新增阶段规划：
  - `docs/阶段一.md`
  - `docs/阶段二.md`
- 新增上下文和协作文件：
  - `AGENTS.md`
  - `docs/prompt-spec.md`
  - `docs/scripts-plan.md`
- 新增前后端骨架：
  - Vue 3 + Vite 前端
  - Express + TypeScript 后端
- 根目录启用 npm workspaces
- 已补全一轮项目依赖到各层 `package.json`

## 当前还没完成

- 依赖尚未实际安装
- ESLint / Prettier 配置文件尚未落地
- Tailwind 尚未真正接入样式管线
- Monaco 尚未真实接入
- Mermaid 尚未真实渲染
- 前端尚未真正请求后端 SSE
- LangGraph 尚未真实接入模型调用

## 当前最适合继续做的事情

1. 在根目录执行 `npm install`
2. 增加 ESLint / Prettier 配置
3. 接前端到 `/api/generate-flow`
4. 接 Monaco 与 Mermaid
5. 将 mock Agent 替换为真实模型调用

## 注意点

- 当前 `agent.ts` 还是 mock 结果
- 当前前端展示的是占位数据
- 文档已经比代码更完整，后续实现要尽量对齐文档，而不是反过来让文档失真
