import { afterEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useWorkspacePage } from '../src/features/workspace/model/useWorkspacePage'
import * as sessionApi from '../src/shared/api/sessions.api'
import * as multiApi from '../src/shared/api/multifile.api'
import type { SessionDetail, SessionWrite } from '../src/entities/session/model/types'
import type { MultiDraft } from '../src/entities/flow/model/multifile'

const lifecycle = vi.hoisted(() => ({ mounted: [] as (() => Promise<void>)[] }))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (hook: () => Promise<void>) => lifecycle.mounted.push(hook),
  onBeforeUnmount: vi.fn()
}))
vi.mock('../src/shared/api/sessions.api', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  getSession: vi.fn()
}))
vi.mock('../src/shared/api/multifile.api', () => ({
  getMultiDetail: vi.fn(),
  saveMultiDraft: vi.fn(),
  getSourceFile: vi.fn()
}))
vi.mock('../src/shared/api/system.api', () => ({ getHealth: async () => ({ ok: true }) }))

const scope = effectScope()
afterEach(() => {
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('上传后直接载入；当前文件为空时仍可清空全部文件，重开会话保持清空', async () => {
  vi.useFakeTimers()
  const sessions = new Map<string, SessionDetail>()
  const drafts = new Map<string, MultiDraft>()
  vi.mocked(sessionApi.getSessions).mockResolvedValue([])
  vi.mocked(sessionApi.createSession).mockImplementation(
    async (id: string, input: SessionWrite = {}) => {
      const detail: SessionDetail = {
        id,
        title: '测试会话',
        fileName: '',
        createdAt: '',
        updatedAt: '',
        language: 'unknown',
        hasResult: false,
        hasDraft: false,
        busy: false,
        draftCode: '',
        draftLanguage: 'unknown',
        sourceCode: '',
        result: null,
        messages: [],
        failed: false,
        ...input
      }
      sessions.set(id, detail)
      return detail
    }
  )
  vi.mocked(sessionApi.updateSession).mockImplementation(async (id, input) => {
    const detail = { ...sessions.get(id)!, ...input }
    sessions.set(id, detail)
    return detail
  })
  vi.mocked(sessionApi.getSession).mockImplementation(async (id) => sessions.get(id)!)
  vi.mocked(multiApi.getMultiDetail).mockImplementation(async (id) => ({
    version: 2,
    draft: drafts.get(id) ?? null,
    // 清空后仍有历史快照，恢复工作区必须以显式空草稿为准。
    snapshot:
      drafts.get(id)?.revision === 2
        ? {
            snapshotId: 'old-snapshot',
            sessionId: id,
            manifestHash: 'old-hash',
            languageDetection: null,
            files: [
              {
                fileId: 'old-file',
                path: 'order.js',
                contentHash: 'old-content',
                byteSize: 10,
                lineCount: 1
              }
            ]
          }
        : null,
    sourceSnapshotId: null,
    result: null,
    messages: [],
    failed: false,
    busy: false
  }))
  vi.mocked(multiApi.saveMultiDraft).mockImplementation(async (id, input) => {
    const saved = { ...structuredClone(input), revision: input.revision + 1 }
    drafts.set(id, saved)
    return saved
  })
  const page = scope.run(() => useWorkspacePage())!
  await lifecycle.mounted[0]!()
  await page.handleUploadFiles([
    new File(['import { total } from "./total.js"; total()'], 'order.js'),
    new File(['export function total() { return 10 }'], 'total.js')
  ] as unknown as FileList)
  expect(page.errorMessage.value).toBe('')
  expect(page.files.value.map((file) => file.path)).toEqual(['order.js', 'total.js'])
  expect(page.activePath.value).toBe('order.js')
  expect(drafts.get(page.threadId.value)?.files).toHaveLength(2)

  // 活动文件为空不能阻止清除其他文件。
  page.code.value = ''
  await page.clearWorkspace()
  expect(page.errorMessage.value).toBe('')
  expect(page.files.value).toEqual([])
  expect(page.code.value).toBe('')
  expect(page.activePath.value).toBe('')
  expect(drafts.get(page.threadId.value)).toEqual({ revision: 2, files: [], activePath: '' })
  const clearedId = page.threadId.value
  await page.resetSession()
  await page.selectSession(clearedId)
  expect(page.threadId.value).toBe(clearedId)
  expect(page.files.value).toEqual([])
  expect(page.code.value).toBe('')
  expect(multiApi.getSourceFile).not.toHaveBeenCalled()
})
