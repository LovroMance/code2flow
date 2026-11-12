import { describe, expect, it } from 'vitest'
import type { UnitFlowDraft } from '../src/domain/multifile/schema'
import { collectUnitControlIssues } from '../src/utils/composeMultiFileFlow'
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
  it('接受同一判断节点的多个出口', () => {
    expect(collectUnitControlIssues(draft)).toEqual([])
  })

  it('指向同一节点的连线共用一个出口', () => {
    const broken = { ...draft, edges: [edge('switch', 'nearby'), edge('switch', 'nearby')] }
    expect(collectUnitControlIssues(broken)).toEqual([
      { range: range(2), message: expect.stringContaining('缺少不同出口'), needsSource: true }
    ])
  })

  it('接受串联判断和无条件的默认出口', () => {
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
    expect(collectUnitControlIssues(chained)).toEqual([])
  })

  it('接受将返回合并到概览动作', () => {
    const summarized = { ...draft, nodes: draft.nodes.map((item) =>
      item.localId === 'nearby' ? { ...item, kind: 'action' as const } : item
    ) }
    expect(collectUnitControlIssues(summarized)).toEqual([])
  })
})
