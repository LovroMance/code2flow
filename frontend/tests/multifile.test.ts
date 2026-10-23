import { afterEach, describe, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import {
  parseDraft,
  parseMultiResult,
  parseMultiDetail
} from '../src/entities/flow/model/multifile'
import { streamMultiFlow } from '../src/shared/api/multifile.api'
import { useFlowGeneration } from '../src/features/flow-generation/model/useFlowGeneration'
import { mappingSelection } from '../src/features/code-editor/model/mappingSelection'
import { equalSourceFiles, mappingFilePath } from '../src/features/workspace/model/sourceFiles'

const result = {
  version: 2,
  snapshotId: 'snapshot',
  analysisId: 'analysis',
  detectedLanguage: 'unknown',
  hasExecutableFlow: true,
  mermaid:
    'flowchart TD\nsubgraph g_1["文件一"]\nn_action_1_f1_u1_1["执行职责"]\nend\nsubgraph g_2["文件二"]\nn_action_1_f2_u2_1["处理数据"]\nend\nn_action_1_f1_u1_1 -.->|"调用"| n_action_1_f2_u2_1',
  mappings: [
    {
      nodeId: 'n_action_1_f1_u1_1',
      unitId: 'u1',
      fileId: 'f1',
      kind: 'action',
      label: '执行职责',
      description: '描述',
      startOffset: 0,
      endOffset: 1,
      lineStart: 1,
      lineEnd: 1,
      columnStart: 1,
      columnEnd: 2,
      evidenceIds: ['e1']
    },
    {
      nodeId: 'n_action_1_f2_u2_1',
      unitId: 'u2',
      fileId: 'f2',
      kind: 'action',
      label: '处理数据',
      description: '描述',
      startOffset: 0,
      endOffset: 1,
      lineStart: 1,
      lineEnd: 1,
      columnStart: 1,
      columnEnd: 2,
      evidenceIds: ['e2']
    }
  ],
  diagnostics: [],
  coverage: {
    complete: true,
    files: [
      { fileId: 'f1', total: 1, covered: 1, missing: [] },
      { fileId: 'f2', total: 1, covered: 1, missing: [] }
    ]
  }
}
afterEach(() => vi.unstubAllGlobals())
it('空草稿表示工作区已清空，活动路径必须同时为空', () => {
  expect(parseDraft({ revision: 2, files: [], activePath: '' })).toEqual({
    revision: 2,
    files: [],
    activePath: ''
  })
  expect(() => parseDraft({ revision: 2, files: [], activePath: 'a.js' })).toThrow()
})
function response(events: unknown[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
        const bytes = new TextEncoder().encode(text)
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      }
    }),
    { status: 200 }
  )
}
describe('v2协议和完成边界', () => {
  it('跨文件定位按fileId切换，活动文件不参与源码一致性；BOM列转换保留UTF-16宽度', () => {
    const files = [
      { path: 'a.ts', content: '\uFEFF😀a\r\n' },
      { path: 'b.ts', content: 'b()' }
    ]
    expect(equalSourceFiles(files, [...files].reverse())).toBe(true)
    expect(equalSourceFiles(files, [{ ...files[0]!, path: 'renamed.ts' }, files[1]!])).toBe(false)
    const snapshot = {
      snapshotId: 's',
      sessionId: 't',
      manifestHash: 'hash',
      languageDetection: null,
      files: [
        { fileId: 'f1', path: 'a.ts', contentHash: 'h1', byteSize: 1, lineCount: 2 },
        { fileId: 'f2', path: 'b.ts', contentHash: 'h2', byteSize: 3, lineCount: 1 }
      ]
    }
    expect(mappingFilePath('f2', snapshot, files)).toBe('b.ts')
    expect(mappingFilePath('foreign', snapshot, files)).toBeUndefined()
    const mapping = {
      ...result.mappings[0]!,
      kind: 'action' as const,
      columnStart: 2,
      columnEnd: 5
    }
    expect(mappingSelection(mapping, files[0]!.content, () => 4)).toMatchObject({
      startColumn: 1,
      endColumn: 4
    })
    expect(mappingSelection({ ...mapping, columnEnd: undefined }, 'x', () => 8).endColumn).toBe(8)
  })
  it('读取UTF-8分片SSE并校验快照和覆盖；无done或终止error均失败', async () => {
    const events = [
      { type: 'metadata', content: result },
      { type: 'mermaid', content: result.mermaid },
      { type: 'mappings', content: result.mappings },
      { type: 'done' }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(events))
    )
    expect(
      (await streamMultiFlow('s', 'snapshot', new AbortController().signal, () => {})).analysisId
    ).toBe('analysis')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(events.slice(0, -1)))
    )
    await expect(
      streamMultiFlow('s', 'snapshot', new AbortController().signal, () => {})
    ).rejects.toThrow('未收到')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([{ type: 'error', content: '覆盖失败' }]))
    )
    await expect(
      streamMultiFlow('s', 'snapshot', new AbortController().signal, () => {})
    ).rejects.toThrow('覆盖失败')
  })
  it('拒绝版本错误、缺失覆盖、重复节点；普通声明空态不解析图', async () => {
    expect(parseMultiResult(result).version).toBe(2)
    expect(() =>
      parseMultiResult({ ...result, coverage: { complete: false, files: [] } })
    ).toThrow()
    expect(() =>
      parseMultiResult({ ...result, mappings: [...result.mappings, ...result.mappings] })
    ).toThrow()
    expect(() => parseMultiDetail({ version: 1 })).toThrow()
    const empty = { ...result, hasExecutableFlow: false, mermaid: '', mappings: [] },
      state = useFlowGeneration()
    await state.restoreMultiOutput(parseMultiResult(empty))
    expect(state.status.value).toBe('done')
    expect(state.mappings.value).toEqual([])
    expect(state.mermaid.value).toBe('')
    state.failRendering('渲染失败')
    expect(state.status.value).toBe('error')
    expect(state.mappings.value).toEqual([])
  })
  it('受控独立子图和调用连线通过真实Mermaid解析器', async () => {
    // Node 无浏览器DOM：只替换清洗适配，不替换Mermaid解析器；安全渲染仍需浏览器验证。
    const previous = Object.getOwnPropertyDescriptors(DOMPurify)
    Object.defineProperties(DOMPurify, {
      sanitize: { value: (text: string) => text, configurable: true },
      addHook: { value: () => {}, configurable: true }
    })
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      await expect(mermaid.parse(result.mermaid)).resolves.toMatchObject({
        diagramType: 'flowchart-v2'
      })
      await expect(mermaid.parse('flowchart TD\na["断裂]')).rejects.toThrow()
    } finally {
      for (const key of ['sanitize', 'addHook']) {
        const descriptor = previous[key]
        if (descriptor) Object.defineProperty(DOMPurify, key, descriptor)
        else Reflect.deleteProperty(DOMPurify, key)
      }
    }
  })
})
