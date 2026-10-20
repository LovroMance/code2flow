// 与重构前快照使用相同物理行口径，区分业务源码和测试，不把锁文件或报告算进精简收益。
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8')).files
const lineCount = (text) => text.split(/\r\n|\r|\n/).length - (text.endsWith('\n') ? 1 : 0)
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? collect(file) : [file]
  })
}
const after = Object.fromEntries(
  [...collect(path.join(root, 'backend/src')), ...collect(path.join(root, 'backend/tests'))]
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [
      path.relative(root, file).replace(/\\/g, '/'),
      {
        lines: lineCount(fs.readFileSync(file, 'utf8')),
        test:
          file.includes('.test.') ||
          file.includes(`${path.sep}test${path.sep}`) ||
          file.includes(`${path.sep}tests${path.sep}`)
      }
    ])
)
const sum = (files, filter = () => true) =>
  Object.entries(files).reduce(
    (total, [name, file]) => total + (filter(name, file) ? file.lines : 0),
    0
  )
const metric = (name, old, current) => ({
  name,
  before: old,
  after: current,
  delta: current - old,
  reductionPercent: Number((((old - current) / old) * 100).toFixed(2))
})
const frontendFiles = collect(path.join(root, 'frontend/src')).filter((file) =>
  /\.(ts|vue|css)$/.test(file)
)
const frontendAfter = frontendFiles.reduce(
  (total, file) => total + lineCount(fs.readFileSync(file, 'utf8')),
  0
)
// 开始时 frontend 无未提交修改，因此 HEAD 正是其重构前快照；后端必须使用工作区快照。
const frontendBefore = frontendFiles.reduce(
  (total, file) =>
    total +
    lineCount(
      execFileSync('git', ['show', `HEAD:${path.relative(root, file).replace(/\\/g, '/')}`], {
        cwd: root,
        encoding: 'utf8'
      })
    ),
  0
)
const production = (_name, file) => !file.test
const test = (_name, file) => file.test
const ai = (name, file) =>
  !file.test &&
  (name.includes('/ai/') ||
    name.includes('/agents/') ||
    name === 'backend/src/services/flow-generation.service.ts' ||
    name.endsWith('/toolCallResultStreamer.ts'))
const metrics = [
  metric('后端业务源码', sum(before, production), sum(after, production)),
  metric('后端测试与夹具', sum(before, test), sum(after, test)),
  metric('后端全部 TypeScript', sum(before), sum(after)),
  metric('AI、编排与生成服务（业务）', sum(before, ai), sum(after, ai)),
  metric('前端 TS/Vue/CSS', frontendBefore, frontendAfter),
  metric('前后端全部源码', sum(before) + frontendBefore, sum(after) + frontendAfter)
]
const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .map((name) => ({
    file: name,
    before: before[name]?.lines ?? 0,
    after: after[name]?.lines ?? 0,
    delta: (after[name]?.lines ?? 0) - (before[name]?.lines ?? 0)
  }))
  .filter((row) => row.delta !== 0)
const report = {
  date: '2026-10-20',
  counting: '物理行，含注释和空行；测试夹具单列；排除 node_modules、dist、生成 JS、文档和锁文件',
  backendFiles: { before: Object.keys(before).length, after: Object.keys(after).length },
  metrics,
  changes
}
fs.writeFileSync(path.join(__dirname, 'line-counts.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
