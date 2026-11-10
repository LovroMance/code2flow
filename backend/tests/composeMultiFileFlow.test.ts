import { describe, expect, it } from 'vitest'
import type { ExecutionUnit, UnitFlowDraft } from '../src/domain/multifile/schema'
import { collectUnitControlIssues } from '../src/utils/composeMultiFileFlow'
import { sourceSwitches } from '../src/utils/sourceChunks'
import { sourceLineRange } from '../src/utils/sourcePositions'

const source = [
  'function shipping(region) {',
  '  switch (region) {',
  "    case 'nearby':",
  '      return 600',
  "    case 'remote':",
  '      return 1800',
  '    default:',
  '      return 1000',
  '  }',
  '}'
].join('\r\n')
const range = (start: number, end = start) => sourceLineRange('file', source, start, end)
const unit: Pick<ExecutionUnit, 'controlRanges'> = {
  controlRanges: [2, 3, 5, 7].map((line) => ({ kind: 'branch', range: range(line) }))
}
const node = (localId: string, kind: UnitFlowDraft['nodes'][number]['kind'], line: number) => ({
  localId,
  kind,
  range: range(line),
  label: localId,
  description: '',
  evidenceIds: ['source'],
  callSiteIds: []
})
const edge = (from: string, to: string) => ({ from, to, label: to })
const draft: UnitFlowDraft = {
  unitId: 'shipping',
  entryLocalId: 'switch',
  emptyReason: '',
  nodes: [
    node('switch', 'decision', 2),
    node('nearby', 'return', 4),
    node('remote', 'return', 6),
    node('default', 'return', 8)
  ],
  edges: ['nearby', 'remote', 'default'].map((to) => edge('switch', to))
}

describe('多文件控制流校验', () => {
  it('接受同一判断节点的三个出口，case 行无须单独建节点', async () => {
    const switches = await sourceSwitches('file', 'shipping.js', source)
    expect(collectUnitControlIssues(draft, unit, switches)).toEqual([])
  })

  it('默认分支有节点但连线缺失时，给出明确的修补位置', async () => {
    const switches = await sourceSwitches('file', 'shipping.js', source)
    const broken = { ...draft, edges: draft.edges.filter(({ to }) => to !== 'default') }
    expect(collectUnitControlIssues(broken, unit, switches)).toEqual([
      { range: range(7), message: '第 2 行的 switch 无法到达第 7 行的默认分支动作', repair: true }
    ])
  })

  it('接受串联判断和无条件的默认出口', async () => {
    const switches = await sourceSwitches('file', 'shipping.js', source)
    const chained = {
      ...draft,
      nodes: [...draft.nodes, node('remote-check', 'decision', 5)],
      edges: [
        edge('switch', 'nearby'),
        edge('switch', 'remote-check'),
        edge('remote-check', 'remote'),
        edge('remote-check', 'default')
      ]
    }
    expect(collectUnitControlIssues(chained, unit, switches)).toEqual([])
  })

  it('把节点类型差异记录为提示', () => {
    const indexed = { ...unit, controlRanges: [{ kind: 'return' as const, range: range(4) }] }
    const summarized = { ...draft, nodes: draft.nodes.map((item) =>
      item.localId === 'nearby' ? { ...item, kind: 'action' as const } : item
    ) }
    expect(collectUnitControlIssues(summarized, indexed)).toEqual([
      { range: range(4), message: '第 4 行（return）建议使用 return 或 end 节点' }
    ])
  })
})
