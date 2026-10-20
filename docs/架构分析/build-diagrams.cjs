// 生成可维护的 Mermaid 源图与离线图集；图集渲染后可内嵌 SVG，无需联网。
const fs = require('node:fs')
const path = require('node:path')
const root = __dirname
const diagrams = [
  [
    '01-system',
    '系统总体架构与技术栈',
    '前端负责交互，服务端负责模型调用和结果约束。虚线表示可选路径。',
    `flowchart TB
subgraph Browser["浏览器 · Vue 3 / TypeScript"]
  Page["WorkspacePage / composables"] --> Editor["Monaco Editor · 代码输入与定位"]
  Page --> Diagram["Mermaid SVG · 预览 / 平移 / 缩放"]
  Page --> Net["Fetch SSE / Axios JSON"]
end
subgraph API["Node.js / Express"]
  HTTP["routes → controller · Zod 入参校验"] --> Service["service · trace 生命周期"]
  Service --> Agent{"Agent provider"}
  Agent -->|langchain 默认| Chain["LangChain · tool calling"]
  Agent -->|graph| Graph["手写状态机 · 节点 / 路由 / 重试"]
  Graph --> Chain
  Graph --> Follow["追问解释 chain"]
  Graph --> Checkpoint[("本地 JSON checkpoint")]
  Service -.-> Trace[("JSONL trace")]
end
Net -->|"POST /api/generate-flow"| HTTP
HTTP -->|"SSE · 图源快照 / mappings"| Net
Net -->|"GET health / POST follow-up"| HTTP
Chain --> Model["ChatOpenAI 适配器 → DeepSeek 兼容端点"]
Follow --> Model`
  ],
  [
    '02-directories',
    '目录结构与职责',
    '只展示有架构意义的目录；node_modules 和 dist 不属于业务源代码。',
    `flowchart LR
Root["Code2Flow · npm workspaces"] --> FE["frontend/src"]
Root --> BE["backend/src"]
Root --> Docs["docs · 规划 / 契约 / 架构"]
Root --> Tooling["根配置 · lint / format / hooks"]
FE --> Entry["main + app · 应用挂载"]
FE --> Pages["pages · 页面组合"]
FE --> Features["features · 编辑 / 图形 / 生成 / 工作区"]
FE --> Shared["entities + shared · 类型 / API / 初始化"]
BE --> HTTP["app + routes + controllers · HTTP"]
BE --> Service["services + agents · 调用与 provider"]
BE --> Domain["domain + prompts · schema / 主规则"]
BE --> AI["ai · llms / chains / tools / graph"]
BE --> Quality["ai/observability + eval · 观测评估"]
BE --> Utils["utils · 校验 / 归一化 / SSE"]`
  ],
  [
    '03-frontend',
    '前端组件、状态与依赖图',
    '实线为组件或调用依赖；虚线为数据/事件回传。状态由 composable 管理。',
    `flowchart TB
Main["main.ts → App.vue"] --> Page["WorkspacePage.vue · 页面组合"]
Page --> Workspace["useWorkspacePage · 输入 / 会话 / 上传 / 追问"]
Workspace --> Generation["useFlowGeneration · idle / streaming / done / error"]
Generation --> SSE["flow-stream.api · Fetch + SSE 分帧"]
Workspace --> JSON["system / follow-up API · Axios"]
Page --> Editor["CodeEditor.vue · Monaco"]
Page --> Diagram["FlowDiagram.vue · 画布交互"]
Diagram --> Render["useMermaidRenderer · 异步渲染防覆盖"]
Render --> Click["buildInteractiveMermaid · 注入 click"]
Generation -.->|"mermaid / mappings"| Diagram
Diagram -.->|select-node| Page
Page -->|"focusMapping"| Editor
Workspace --> Types["entities/flow · 前端契约"]
Generation --> Types`
  ],
  [
    '04-backend',
    '后端分层与 provider 分流',
    'langchain 共用能力层；graph 才进入自定义检查点和节点路由。',
    `flowchart TB
Entry["index.ts / createApp"] --> Routes["routes · /api 路由"]
Routes --> Controller["flow.controller · 入参 / 响应"]
Controller --> Service["flow-generation.service · trace + 默认 checkpointer"]
Service --> Agent["code-flow.agent · provider 选择"]
Agent -->|langchain| Chain["code-flow.chain · 最多 4 轮工具调用"]
Agent -->|graph| Graph["code-flow.graph · 手写状态驱动"]
Graph --> Nodes["detect / analyze / validate / normalize / retry"]
Nodes --> Chain
Graph --> Explain["explain-followup chain"]
Graph --> CP["checkpointer 接口 · 内存 / 文件"]
Chain --> LLM["llms/openai · ChatOpenAI"]
Explain --> LLM
Chain --> Tools["detect_language / submit_code_flow_result"]
Chain --> Contract["domain + utils · schema / mapping / Mermaid"]
Nodes --> Contract
Service -.-> Obs["observability · collector / JSONL sink"]`
  ],
  [
    '05-generation-sequence',
    '生成流程图端到端时序',
    '表示 graph 模式成功路径。检测语言可重复发 metadata；最终 mappings 下发后才具备点击定位数据。',
    `sequenceDiagram
actor U as 用户
participant W as Vue 工作区
participant C as Controller
participant S as Service / Agent
participant G as 手写 Graph
participant P as 文件 Checkpoint
participant L as LangChain / 模型
U->>W: 编辑代码并点击生成
W->>C: POST code + thread_id
C->>C: Zod 验证并建立 SSE
C->>S: streamGenerateFlow
S->>G: 注入 callbacks / trace / checkpointer
G->>P: load generate:thread_id
P-->>G: 上次上下文或空
G->>G: detect-language
G-->>C: metadata 回调
C-->>W: SSE metadata
G->>P: save
G->>L: analyze-flow / generateCodeFlowDraft
loop 最多 4 轮工具调用
L->>L: 模型流与工具消息往返
L-->>C: 满足轻量检查的完整行快照
C-->>W: SSE mermaid
W->>W: Mermaid 渲染最新快照
end
L-->>G: 结构化结果
G->>G: validate → normalize
G->>P: save 最终结果
G-->>S: result
S->>S: 完成并保存 trace
S-->>C: result
C-->>W: metadata → mermaid → mappings → done
W-->>U: 完整图与可定位节点`
  ],
  [
    '06-graph-state',
    'Graph 状态、重试与异常旁路',
    'maxRetries 默认 1。红色旁路体现当前 analyze 抛错不进入条件重试。',
    `flowchart TD
Init["创建初始 state"] --> Restore["恢复同 thread 的 checkpoint"]
Restore --> Mode{"mode"}
Mode -->|generate| Detect["detect-language"]
Detect --> SaveDetect["保存 checkpoint"]
SaveDetect --> Analyze["analyze-flow · 调用 draft"]
Analyze -->|成功返回| Validate["validate · 结构 / 图源特征 / 语言一致性"]
Validate --> Route{"无错误且有 result?"}
Route -->|是| Normalize["normalize-flow · 行号归一化"]
Normalize --> Save["保存 checkpoint"]
Save --> End["返回 result"]
Route -->|否| Limit{"retryCount 小于 maxRetries?"}
Limit -->|是| Retry["retry · 加计数并清空瞬时结果"]
Retry --> SaveRetry["保存 checkpoint"]
SaveRetry --> Analyze
Limit -->|否| Error["保存失败状态并抛错"]
Analyze -->|"异常直接传播"| Bypass["跳过 validate / retry"]
Bypass --> Fail["service 记录失败 → SSE error"]
Error --> Fail
Mode -->|followup| Explain["explain-followup · 检查问题与已有图"]
Explain --> FollowSave["保存最后 explanation"]
FollowSave --> FollowEnd["返回 explanation 或抛错"]
classDef bad fill:#fff1f2,stroke:#be123c,color:#881337
class Bypass,Fail,Error bad`
  ],
  [
    '07-stream-state',
    'SSE 事件与前端状态流转',
    '图源按快照替换。网络异常没有统一设置 error，正常 EOF 也可能在没有 done 时被当作完成。',
    `flowchart LR
Idle["idle"] -->|点击生成| Streaming["streaming · 清空 mappings"]
Streaming --> Meta["metadata · 更新语言"]
Meta --> Streaming
Streaming --> Mermaid["mermaid · 替换完整图源并渲染"]
Mermaid --> Streaming
Streaming --> Mapping["mappings · 更新最终映射"]
Mapping --> Streaming
Streaming -->|"SSE done"| Done["done"]
Streaming -->|"SSE error"| Error["error · 显示消息并抛错"]
Streaming -->|"流结束仍在 streaming"| Done
Streaming -.->|"非 2xx / 断网 / JSON 解析失败"| Stuck["抛给页面 · 可能仍为 streaming"]
Done -->|重新生成| Streaming
Error -->|重新生成| Streaming
Done -->|重置输出| Idle
classDef warning fill:#fff7ed,stroke:#c2410c,color:#7c2d12
class Stuck warning`
  ],
  [
    '08-node-linkage',
    '图节点点击到源码定位链路',
    '当前为图到代码单向联动。节点点击还会覆盖追问草稿并清空旧回答。',
    `sequenceDiagram
actor U as 用户
participant M as Mermaid SVG
participant D as FlowDiagram
participant P as WorkspacePage
participant W as useWorkspacePage
participant E as CodeEditor / Monaco
Note over M,D: 渲染前注入 click nodeId code2flowNodeClick
U->>M: 点击节点
M->>D: 全局 code2flowNodeClick(nodeId)
D->>P: emit select-node
P->>W: primeFollowUpQuestionFromNode(nodeId)
W->>W: 用 nodeId 查找 mapping
W->>W: 预填节点、类型、行号追问并清空回答
W-->>P: mapping
P->>E: focusMapping(mapping)
E->>E: focus + revealLinesInCenter
E->>E: setSelection + deltaDecorations
E-->>U: 滚动并高亮对应代码行`
  ],
  [
    '09-followup-sequence',
    '追问解释与会话恢复时序',
    '要求 provider=graph。恢复的是最后一份生成上下文，不是聊天消息历史。',
    `sequenceDiagram
actor U as 用户
participant W as 工作区
participant A as Controller / Service / Agent
participant G as Graph
participant P as 文件 Checkpoint
participant L as 解释 chain / 模型
U->>W: 输入问题或点击节点预填
W->>A: POST /api/follow-up（thread_id, question, code）
A->>A: 校验入参和 graph provider
A->>G: mode=followup
G->>P: load generate:thread_id
P-->>G: code / result / explanation
G->>G: 本次 code 优先，恢复旧 result
alt 缺少问题或已有 result
G-->>A: error
A-->>W: HTTP 400 JSON
else 可解释
G->>L: 当前 code + question + Mermaid + mappings
Note over G,L: 不传历史问答或上次 explanation
L-->>G: 完整解释文本（非流式）
G->>P: 保存最后 explanation
G-->>A: explanation
A-->>W: JSON response
W-->>U: 覆盖显示当前回答
end`
  ],
  [
    '10-data-contract',
    '结果、映射与检查点数据关系',
    '这是逻辑数据关系图；项目没有关系型数据库。数组和可选字段以实际 schema/state 为准。',
    `classDiagram
class GenerationRequest {
  string code
  string thread_id_optional
}
class FlowResult {
  SupportedLanguage detectedLanguage
  string mermaid
  NodeMapping[] mappings
}
class NodeMapping {
  string nodeId
  NodeKind kind
  string label
  string description
  int lineStart
  int lineEnd
  int columnStart_optional
  int columnEnd_optional
}
class Checkpoint {
  string code_optional
  SupportedLanguage detectedLanguage_optional
  FlowResult result_optional
  string explanation_optional
}
class GraphState {
  string mode
  string threadId_optional
  string question_optional
  int retryCount
  int maxRetries
  string error_optional
  string[] validationErrors_optional
}
FlowResult "1" *-- "0..*" NodeMapping : mappings
Checkpoint "1" o-- "0..1" FlowResult : result
GenerationRequest --> GraphState : initialize
GraphState --> Checkpoint : save_subset
Checkpoint --> GraphState : restore_context`
  ],
  [
    '11-evaluation',
    '观测、评估与 A/B 对比链路',
    '轨迹与评估产物写本地文件。确定性检查关注结构和关键词，不证明控制流语义正确。',
    `flowchart TB
Online["在线 controller"] --> Service["service · runWithTrace"]
Dataset["baseline.dataset · 10 条样例"] --> Runner["eval runner · 默认并发 1"]
Runner -->|独立 collector| Service
Service --> Agent["Agent → graph / chain → 模型"]
Agent --> Metrics["步骤耗时 / 轮次 / Token / 重试"]
Metrics --> Collector["TraceCollector"]
Service --> Collector
Collector --> OnlineSink[("在线 runs.jsonl")]
Collector --> EvalSink[("独立评估 traces.jsonl")]
Agent --> Result["FlowResult"]
Result --> Evaluator["6 类检查 · 结构 / 映射 / 行号 / 类型 / 标签 / 数量"]
Dataset --> Evaluator
Evaluator --> Report[("评估 report.json")]
EvalSink --> Report
Report --> Compare["A/B · 配置差异 / 指标 / 逐例分数"]
Compare --> Markdown["对比 Markdown · 启发式结论"]
OnlineSink --> Analyze["eval:traces · 配置分组统计"]`
  ],
  [
    '12-runtime',
    '开发运行拓扑与部署边界',
    '上半部分是配置已实现的本地路径；下半部分仅是部署建议，不表示仓库已经配置。',
    `flowchart TB
subgraph Local["已实现 · 本地开发"]
Browser["浏览器 localhost:5173"] --> Vite["Vite dev server · Vue / Monaco / Mermaid"]
Vite -->|"/api 代理"| Express["Express localhost:3000"]
Express --> LLM["DeepSeek 兼容端点"]
Express --> Disk[("backend 工作目录下 .code2flow")]
end
subgraph Deploy["建议 · 生产部署边界"]
Client["浏览器"] -.-> Static["静态前端构建产物"]
Client -.-> Gateway["同源网关 /api · 放行 SSE"]
Gateway -.-> Server["Node 单实例服务"]
Server -.-> Volume[("持久化卷 · checkpoint / traces")]
Server -.-> Model["模型端点"]
end
Note["若改为前后端分域：需配置 API URL 与 CORS；当前未启用 cors"] -.-> Gateway`
  ]
]
fs.mkdirSync(path.join(root, 'diagrams'), { recursive: true })
for (const [id, , , source] of diagrams)
  fs.writeFileSync(path.join(root, 'diagrams', id + '.mmd'), source + '\n')
fs.writeFileSync(
  path.join(root, 'diagrams.json'),
  JSON.stringify(
    diagrams.map(([id, title, description, source]) => ({ id, title, description, source })),
    null,
    2
  )
)
const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cards = diagrams
  .map(
    ([id, title, desc, source]) =>
      `<section id="${id}"><header><div><span class="number">${id.slice(0, 2)} / 12</span><h2>${title}</h2><p>${desc}</p></div><div class="actions"><button onclick="zoom('${id}',-0.15)" aria-label="缩小">−</button><button onclick="zoom('${id}',0.15)" aria-label="放大">＋</button><button onclick="saveSvg('${id}')">下载 SVG</button><a href="diagrams/${id}.mmd" download>源图</a></div></header><div class="viewport"><div class="drawing" data-id="${id}"><pre class="mermaid">${escape(source)}</pre></div></div><details><summary>查看 Mermaid 源码</summary><pre>${escape(source)}</pre></details></section>`
  )
  .join('\n')
let html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Code2Flow · 架构与功能图集</title><style>
:root{font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:#17283a;background:#f2f5f8}*{box-sizing:border-box}body{margin:0}aside{position:fixed;inset:0 auto 0 0;width:250px;background:#10283d;color:white;padding:32px 22px;overflow:auto}aside strong{font-size:25px;letter-spacing:-1px}aside p{font-size:12px;color:#a8c2d4;line-height:1.7}nav a{display:block;color:#d8e6ef;text-decoration:none;padding:10px 8px;border-radius:5px;font-size:13px}nav a:hover{background:#23485f}main{max-width:1600px;margin-left:250px;padding:40px}h1{font-size:35px;letter-spacing:-1px;margin:8px 0 14px}p{line-height:1.8;color:#536779}.intro{margin-bottom:30px}.tag,.number{font:12px Consolas,monospace;color:#087d82;letter-spacing:1px}.links a{color:#087d82;margin-right:20px}section{scroll-margin-top:20px;background:white;border:1px solid #dce4eb;border-radius:12px;margin:22px 0;padding:24px;box-shadow:0 4px 16px #19324d06}header{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}h2{font-size:21px;margin:8px 0}header p{font-size:13px;margin:8px 0;max-width:850px}.actions{display:flex;gap:6px;white-space:nowrap;flex-wrap:wrap;justify-content:flex-end}button,.actions a{background:#f5f8fa;color:#25475c;border:1px solid #d7e2e9;padding:7px 10px;border-radius:5px;cursor:pointer;font:12px inherit;text-decoration:none}.viewport{overflow:auto;max-height:880px;padding:25px 10px;border-top:1px solid #edf1f5;margin-top:16px}.drawing{min-width:720px;transform-origin:top left}.drawing svg{max-width:100%!important;height:auto;display:block;margin:0 auto}details{border-top:1px solid #edf1f5;padding-top:14px;color:#60758a;font-size:12px}pre{white-space:pre-wrap;font:12px/1.65 Consolas,'Microsoft YaHei',monospace}.status{font-size:12px;color:#60758a}@media(max-width:1000px){aside{position:static;width:auto;padding:20px}nav{display:flex;flex-wrap:wrap}nav a{font-size:11px;padding:6px}main{margin:0;padding:20px}header{display:block}.actions{justify-content:flex-start}h1{font-size:28px}}@media print{aside,.actions,details{display:none}main{margin:0;padding:0}section{break-inside:avoid;box-shadow:none}.viewport{max-height:none;overflow:visible}.drawing{min-width:0}}
</style><aside><strong>Code2Flow<span style="color:#5ce1cd"> / </span></strong><p>架构与功能链路图集<br>2026.10.19 · 当前工作区快照</p><nav>${diagrams.map(([id, title]) => `<a href="#${id}">${id.slice(0, 2)}　${title}</a>`).join('')}</nav></aside><main><div class="intro"><span class="tag">ARCHITECTURE / CODE TO FLOW</span><h1>从代码输入，到可追溯的流程图</h1><p>12 张图覆盖系统边界、目录、模块、生成、重试、SSE、节点联动、追问、数据关系、评估与运行拓扑。<br>依据实际代码绘制：graph 为手写状态机；langchain 为默认 provider；部署建议单独标注。</p><p class="links"><a href="分析报告.md">完整分析报告</a><a href="源码索引.md">源码证据索引</a><a href="验证记录.json">验证记录</a></p><p class="status" id="status">正在渲染图表…</p></div>${cards}</main><script src="../../node_modules/mermaid/dist/mermaid.min.js"></script><script>
const scales={};function zoom(id,delta){const el=document.querySelector('[data-id="'+id+'"]');scales[id]=Math.max(.4,Math.min(2.5,(scales[id]||1)+delta));el.style.zoom=scales[id]}
function saveSvg(id){const el=document.querySelector('[data-id="'+id+'"] svg');if(!el)return;const blob=new Blob([el.outerHTML],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=id+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
window.diagramErrors=[];window.renderDone=false;async function renderAll(){mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Segoe UI, Microsoft YaHei, sans-serif',themeVariables:{primaryColor:'#e9f5f6',primaryTextColor:'#17394a',primaryBorderColor:'#168b8e',lineColor:'#7891a3',secondaryColor:'#edf2fa',tertiaryColor:'#f8fafc'},flowchart:{htmlLabels:false,curve:'basis'},sequence:{useMaxWidth:true,wrap:true}});for(const el of document.querySelectorAll('.drawing')){try{const source=el.querySelector('pre').textContent;const result=await mermaid.render('svg-'+el.dataset.id,source);el.innerHTML=result.svg}catch(e){window.diagramErrors.push({id:el.dataset.id,error:String(e)})}}window.renderDone=true;document.getElementById('status').textContent=window.diagramErrors.length?'渲染失败：'+JSON.stringify(window.diagramErrors):'12 / 12 图已完成渲染 · 可缩放与下载 SVG · 虚线含义以各图说明为准'}renderAll();
</script></html>`
// 已导出 SVG 时优先内嵌：双击图集不再依赖 node_modules 或 Mermaid 运行时。
if (
  !process.argv.includes('--render') &&
  diagrams.every(([id]) => fs.existsSync(path.join(root, 'diagrams', id + '.svg')))
) {
  for (const [id, , , source] of diagrams) {
    html = html.replace(`<pre class="mermaid">${escape(source)}</pre>`, () =>
      fs.readFileSync(path.join(root, 'diagrams', id + '.svg'), 'utf8')
    )
  }
  html = html.replace('<script src="../../node_modules/mermaid/dist/mermaid.min.js"></script>', '')
  const start = html.indexOf('window.diagramErrors=')
  const end = html.indexOf('</script>', start)
  html = html.slice(0, start) + 'window.diagramErrors=[];window.renderDone=true;' + html.slice(end)
  html = html.replace('正在渲染图表…', '12 / 12 图已完成渲染 · 离线可用 · 可缩放并下载 SVG')
}
fs.writeFileSync(path.join(root, '图表总览.html'), html)
console.log('Created 12 Mermaid sources and diagram viewer.')
