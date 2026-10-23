import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isAxiosError } from 'axios'
import { SAMPLE_CODE } from '../config/sampleCode'
import { equalSourceFiles, mappingFilePath } from './sourceFiles'
import { getHealth } from '../../../shared/api/system.api'
import { postFollowUp } from '../../../shared/api/follow-up.api'
import * as sessionApi from '../../../shared/api/sessions.api'
import * as multiApi from '../../../shared/api/multifile.api'
import type {
  SourceFileInput,
  SourceSnapshot,
  MultiFileMapping
} from '../../../entities/flow/model/multifile'
import { useFlowGeneration } from '../../flow-generation/model/useFlowGeneration'
import type { NodeMapping, SupportedLanguage } from '../../../entities/flow/model/types'
import type {
  SessionDetail,
  SessionMessage,
  SessionSummary
} from '../../../entities/session/model/types'
import {
  SUPPORTED_FILE_EXTENSIONS,
  inferLanguageFromExtension
} from '../../../entities/flow/model/languages'

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024
const ACTIVE_SESSION_KEY = 'code2flow.active-session'

// 浏览器偏好不可用时仍允许使用工作区；源码和会话以服务端 SQLite 为准。
function preference(key: string, value?: string) {
  try {
    if (value !== undefined) localStorage.setItem(key, value)
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function message(error: unknown, fallback: string) {
  if (isAxiosError<{ error?: unknown }>(error) && typeof error.response?.data.error === 'string') {
    return error.response.data.error
  }
  return error instanceof Error && !isAxiosError(error) ? error.message : fallback
}

export function useWorkspacePage() {
  const singleCode = ref(SAMPLE_CODE)
  const files = ref<SourceFileInput[]>([])
  const pendingFiles = ref<SourceFileInput[]>([])
  const activePath = ref('')
  const multiSnapshot = ref<SourceSnapshot | null>(null)
  const snapshotFiles = ref<SourceFileInput[] | null>(null)
  const multiRevision = ref(0)
  const code = computed({
    get: () =>
      files.value.length
        ? (files.value.find((f) => f.path === activePath.value)?.content ?? '')
        : singleCode.value,
    set: (value: string) => {
      const file = files.value.find((f) => f.path === activePath.value)
      if (file) file.content = value
      else singleCode.value = value
    }
  })
  const healthStatus = ref('checking')
  const uploadFileName = ref('')
  const workspaceError = ref('')
  const threadId = ref<string>(crypto.randomUUID())
  const sessionTitle = ref('未命名分析')
  const sessions = ref<SessionSummary[]>([])
  const sessionSearch = ref('')
  const sessionLoading = ref(true)
  const listLoading = ref(false)
  const listError = ref('')
  const sidebarCollapsed = ref(preference('code2flow.sidebar-collapsed') === 'true')
  const followUpQuestion = ref('')
  const followUpMessages = ref<SessionMessage[]>([])
  const followUpStatus = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
  const sourceSnapshot = ref<string | null>(null)
  const saveStatus = ref<'saved' | 'pending' | 'saving' | 'error'>('pending')
  const {
    detectedLanguage,
    errorMessage,
    generateFlow,
    isLoading,
    mappings,
    mermaid,
    resetOutput,
    restoreOutput,
    setDetectedLanguage,
    status,
    multiResult,
    progressText,
    generateMultiFlow,
    restoreMultiOutput,
    cancelGeneration,
    failRendering
  } = useFlowGeneration()
  let persisted = false
  let applying = true
  let draftRevision = 0
  let savedRevision = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<void> | undefined
  let alive = true

  const isWorkspaceBusy = computed(
    () => isLoading.value || sessionLoading.value || followUpStatus.value === 'loading'
  )
  const sourceChanged = computed(() =>
    files.value.length
      ? snapshotFiles.value !== null && !equalSourceFiles(files.value, snapshotFiles.value)
      : sourceSnapshot.value !== null && code.value !== sourceSnapshot.value
  )
  const canAskFollowUp = computed(
    () =>
      status.value === 'done' &&
      !sourceChanged.value &&
      (mappings.value.length > 0 || multiResult.value !== null) &&
      !isWorkspaceBusy.value
  )
  const combinedErrorMessage = computed(() => workspaceError.value || errorMessage.value)
  function fileDocumentId(path: string) {
    return `${threadId.value}/${multiSnapshot.value?.snapshotId ?? 'draft'}/${multiSnapshot.value?.files.find((f) => f.path === path)?.fileId ?? path}`
  }
  const filteredSessions = computed(() => {
    const query = sessionSearch.value.trim().toLowerCase()
    return sessions.value.filter((session) =>
      `${session.title} ${session.fileName}`.toLowerCase().includes(query)
    )
  })
  const lineCount = computed(() => (code.value ? code.value.split(/\r\n|\r|\n/).length : 0))
  const statusText = computed(() =>
    isLoading.value && files.value.length
      ? progressText.value || '分析中'
      : { idle: '未生成', streaming: '生成中', done: '已生成', error: '生成失败' }[status.value]
  )
  const saveStatusText = computed(
    () =>
      ({ saved: '已保存', pending: '草稿待保存', saving: '保存中…', error: '保存失败' })[
        saveStatus.value
      ]
  )

  function upsertSummary(detail: SessionSummary) {
    sessions.value = [detail, ...sessions.value.filter((item) => item.id !== detail.id)].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    )
  }

  async function refreshSessions() {
    if (listLoading.value) return
    listLoading.value = true
    listError.value = ''
    try {
      sessions.value = await sessionApi.getSessions()
    } catch (error) {
      listError.value = message(error, '无法加载会话列表，请重试。')
    } finally {
      listLoading.value = false
    }
  }

  // 所有草稿写入顺序执行；保存期间的新修改使用下一版本继续保存。
  async function saveDraft() {
    if (saveTimer) clearTimeout(saveTimer)
    if (saving) await saving
    if (persisted && savedRevision === draftRevision) return
    const task = (async () => {
      saveStatus.value = 'saving'
      try {
        while (!persisted || savedRevision !== draftRevision) {
          const revision = draftRevision
          const input = {
            title: sessionTitle.value,
            fileName: uploadFileName.value,
            draftCode: files.value.length ? '' : code.value,
            draftLanguage: detectedLanguage.value
          }
          const detail = persisted
            ? await sessionApi.updateSession(threadId.value, input)
            : await sessionApi.createSession(threadId.value, input)
          persisted = true
          if (files.value.length) {
            const saved = await multiApi.saveMultiDraft(threadId.value, {
              revision: multiRevision.value,
              files: files.value.map((f) => ({ ...f })),
              activePath: activePath.value
            })
            multiRevision.value = saved.revision
            if (revision === draftRevision) {
              applying = true
              files.value = saved.files
              activePath.value = saved.activePath
              applying = false
            }
          }
          savedRevision = revision
          upsertSummary(detail)
          preference(ACTIVE_SESSION_KEY, threadId.value)
        }
        saveStatus.value = 'saved'
      } catch (error) {
        saveStatus.value = 'error'
        throw error
      }
    })()
    saving = task
    try {
      await task
    } finally {
      if (saving === task) saving = undefined
    }
  }

  async function retrySave() {
    if (isWorkspaceBusy.value) return
    workspaceError.value = ''
    try {
      await saveDraft()
    } catch (error) {
      workspaceError.value = message(error, '草稿保存失败，请重试。')
    }
  }

  watch(
    [code, files, activePath, detectedLanguage, uploadFileName, sessionTitle],
    () => {
      if (applying) return
      draftRevision += 1
      saveStatus.value = 'pending'
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        if (!alive || isWorkspaceBusy.value) return
        void saveDraft().catch((error: unknown) => {
          workspaceError.value = message(error, '草稿保存失败，切换前请重试。')
        })
      }, 700)
    },
    { flush: 'sync', deep: true }
  )

  async function applySession(detail: SessionDetail) {
    const multi = await multiApi.getMultiDetail(detail.id)
    if (multi.busy) throw new Error('该会话正在处理请求。')
    const restoredFiles =
      multi.draft?.files ??
      (multi.snapshot
        ? await Promise.all(
            multi.snapshot.files.map(async (f) => ({
              path: f.path,
              content: await multiApi.getSourceFile(detail.id, multi.snapshot!.snapshotId, f.fileId)
            }))
          )
        : [])
    const sourceFiles = multi.snapshot
      ? await Promise.all(
          multi.snapshot.files.map(async (f) => ({
            path: f.path,
            content: await multiApi.getSourceFile(detail.id, multi.snapshot!.snapshotId, f.fileId)
          }))
        )
      : null
    // 恢复期间暂停草稿监听，避免把半套恢复状态写回服务端。
    applying = true
    try {
      threadId.value = detail.id
      sessionTitle.value = detail.title
      uploadFileName.value = detail.fileName
      files.value = restoredFiles
      activePath.value = multi.draft?.activePath ?? restoredFiles[0]?.path ?? ''
      singleCode.value = detail.draftCode
      multiRevision.value = multi.draft?.revision ?? 0
      multiSnapshot.value = multi.snapshot
      snapshotFiles.value = sourceFiles
      setDetectedLanguage(detail.draftLanguage)
      sourceSnapshot.value = detail.result ? detail.sourceCode : null
      restoreOutput(detail.result, detail.failed)
      if (restoredFiles.length) await restoreMultiOutput(multi.result, multi.failed)
      followUpMessages.value = restoredFiles.length ? multi.messages : detail.messages
      followUpQuestion.value = ''
      followUpStatus.value = detail.messages.length ? 'done' : 'idle'
      draftRevision = 0
      savedRevision = 0
      persisted = true
      saveStatus.value = 'saved'
      workspaceError.value = ''
      upsertSummary(detail)
      preference(ACTIVE_SESSION_KEY, detail.id)
    } finally {
      applying = false
    }
  }

  async function selectSession(id: string) {
    if (isWorkspaceBusy.value || id === threadId.value) return
    sessionLoading.value = true
    workspaceError.value = ''
    try {
      await saveDraft()
      const detail = await sessionApi.getSession(id)
      if (detail.busy) throw new Error('该会话正在处理请求，请稍后刷新列表。')
      await applySession(detail)
    } catch (error) {
      workspaceError.value = message(error, '切换失败，已保留当前会话。')
    } finally {
      sessionLoading.value = false
    }
  }

  async function startSession(
    content = '',
    fileName = '',
    language: SupportedLanguage = 'unknown'
  ) {
    if (isWorkspaceBusy.value) return
    sessionLoading.value = true
    workspaceError.value = ''
    try {
      await saveDraft()
      const detail = await sessionApi.createSession(crypto.randomUUID(), {
        title: fileName || '未命名分析',
        fileName,
        draftCode: content,
        draftLanguage: language
      })
      await applySession(detail)
    } catch (error) {
      workspaceError.value = message(error, '新建会话失败，已保留当前内容。')
    } finally {
      sessionLoading.value = false
    }
  }

  async function renameSession(title: string) {
    if (isWorkspaceBusy.value || !title.trim()) return
    sessionTitle.value = title.trim().slice(0, 100)
    await retrySave()
  }

  async function removeSession() {
    if (isWorkspaceBusy.value) return
    sessionLoading.value = true
    workspaceError.value = ''
    try {
      await saveDraft()
      await sessionApi.deleteSession(threadId.value)
      sessions.value = sessions.value.filter((item) => item.id !== threadId.value)
      const next = sessions.value.find((item) => !item.busy)
      // 删除成功后即使下一条读取失败，也不保留已删除会话的可操作旧图。
      applying = true
      threadId.value = crypto.randomUUID()
      sessionTitle.value = '未命名分析'
      uploadFileName.value = ''
      files.value = []
      activePath.value = ''
      multiSnapshot.value = null
      snapshotFiles.value = null
      multiRevision.value = 0
      code.value = ''
      setDetectedLanguage('unknown')
      resetOutput()
      sourceSnapshot.value = null
      followUpMessages.value = []
      followUpQuestion.value = ''
      followUpStatus.value = 'idle'
      persisted = false
      saveStatus.value = 'pending'
      savedRevision = draftRevision = 0
      preference(ACTIVE_SESSION_KEY, '')
      applying = false
      if (next) await applySession(await sessionApi.getSession(next.id))
      else await saveDraft()
    } catch (error) {
      workspaceError.value = message(error, '删除或加载会话失败，请刷新列表。')
    } finally {
      applying = false
      sessionLoading.value = false
    }
  }

  /** 先保存编辑草稿，再固定多文件快照；生成及后续追问始终绑定这一份正文。 */
  async function handleGenerate() {
    if (isWorkspaceBusy.value || !code.value.trim()) return
    // 提交前先保存草稿，并锁定会话切换；SSE 只能更新本次源码所在会话。
    sessionLoading.value = true
    workspaceError.value = ''
    try {
      await saveDraft()
      followUpQuestion.value = ''
      followUpMessages.value = []
      followUpStatus.value = 'idle'
      sourceSnapshot.value = null
      if (files.value.length) {
        resetOutput(true)
        const snapshot = await multiApi.createSnapshot(threadId.value, files.value)
        multiSnapshot.value = snapshot
        snapshotFiles.value = files.value.map((f) => ({ ...f }))
        await generateMultiFlow(threadId.value, snapshot.snapshotId)
      } else {
        await generateFlow({ code: code.value, threadId: threadId.value })
        sourceSnapshot.value = code.value
      }
    } catch (error) {
      workspaceError.value = message(error, '生成失败，请重试。')
    } finally {
      sessionLoading.value = false
      // metadata 会更新语言；流结束后再保存，避免与同线程生成争用锁。
      if (persisted) {
        try {
          await saveDraft()
        } catch (error) {
          workspaceError.value = message(error, '分析已结束，但草稿保存失败。')
        }
      }
      await refreshSessions()
    }
  }

  async function handleFollowUp() {
    if (!canAskFollowUp.value || !followUpQuestion.value.trim()) return
    const question = followUpQuestion.value.trim()
    followUpStatus.value = 'loading'
    workspaceError.value = ''
    try {
      await saveDraft()
      const response =
        files.value.length && multiSnapshot.value
          ? await multiApi.multiFollowUp(threadId.value, multiSnapshot.value.snapshotId, question)
          : await postFollowUp({ threadId: threadId.value, question, code: code.value })
      followUpMessages.value.push(
        { role: 'user', content: question },
        { role: 'assistant', content: response.explanation }
      )
      followUpQuestion.value = ''
      followUpStatus.value = 'done'
    } catch (error) {
      followUpStatus.value = 'error'
      workspaceError.value = message(error, '追问失败，请重试。')
    } finally {
      await refreshSessions()
    }
  }

  async function handleUploadFile(file: File | null | undefined) {
    if (!file || isWorkspaceBusy.value) return
    workspaceError.value = ''
    const name = file.name.trim()
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
    if (!SUPPORTED_FILE_EXTENSIONS.some((value) => value === extension)) {
      workspaceError.value = `暂不支持 ${extension || '该类型'} 文件，请上传常见文本代码文件。`
      return
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      workspaceError.value = '文件过大，请上传小于 200KB 的代码文件。'
      return
    }
    // 读取期间也锁定切换，避免慢文件覆盖用户刚切换的会话。
    sessionLoading.value = true
    try {
      const content = await file.text()
      if (!content.trim()) throw new Error('文件内容为空，未检测到可分析的代码。')
      sessionLoading.value = false
      await startSession(content, name, inferLanguageFromExtension(extension))
    } catch (error) {
      workspaceError.value = message(error, '读取文件失败，请重试。')
    } finally {
      sessionLoading.value = false
    }
  }

  async function handleUploadFiles(selected: FileList | null) {
    if (!selected?.length || isWorkspaceBusy.value) return
    workspaceError.value = ''
    if (selected.length > 20) {
      workspaceError.value = '最多上传20个文件。'
      return
    }
    sessionLoading.value = true
    try {
      const loaded: SourceFileInput[] = []
      let total = 0
      const errors: string[] = []
      for (const file of Array.from(selected)) {
        try {
          const extension = file.name.includes('.')
            ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
            : ''
          if (!SUPPORTED_FILE_EXTENSIONS.includes(extension))
            throw new Error('不支持的文本代码扩展名')
          total += file.size
          if (file.size > MAX_UPLOAD_SIZE_BYTES || total > 2097152)
            throw new Error('超过单文件200 KiB或总计2 MiB限制')
          // fatal拒绝无效UTF-8，ignoreBOM保留原文BOM，禁止静默替换或跳过。
          const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            await file.arrayBuffer()
          )
          if (
            !content.replace(/^\uFEFF/, '').trim() ||
            [...content].some((c) => c.charCodeAt(0) < 32 && !'\t\r\n'.includes(c))
          )
            throw new Error('空文件或二进制内容')
          loaded.push({ path: file.webkitRelativePath || file.name, content })
        } catch (error) {
          errors.push(`${file.name}：${error instanceof Error ? error.message : '读取失败'}`)
        }
      }
      if (errors.length) throw new Error(errors.join('；'))
      pendingFiles.value = loaded
    } catch (error) {
      workspaceError.value = message(error, '读取文件失败。')
    } finally {
      sessionLoading.value = false
    }
  }
  /** 用户确认预览后才更新正式文件集合，使草稿保存与旧图失效基于同一批文件。 */
  async function confirmUploadFiles() {
    if (isWorkspaceBusy.value || !pendingFiles.value.length) return
    workspaceError.value = ''
    sessionLoading.value = true
    try {
      const loaded = pendingFiles.value.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/') }))
      if (
        new Set(loaded.map((f) => f.path)).size !== loaded.length ||
        loaded.some(
          (f) => !f.path || /^(?:\/|[a-z]:)/i.test(f.path) || f.path.split('/').includes('..')
        )
      )
        throw new Error('请为每个文件填写不重复的项目内相对路径，不能使用绝对路径或上级目录。')
      await saveDraft()
      const detail = await sessionApi.createSession(crypto.randomUUID(), {
        title: loaded[0]!.path,
        fileName: `${loaded.length}个文件`,
        draftCode: ''
      })
      await applySession(detail)
      files.value = loaded
      activePath.value = loaded[0]!.path
      uploadFileName.value = `${loaded.length}个文件`
      await saveDraft()
      pendingFiles.value = []
    } catch (error) {
      workspaceError.value = message(error, '读取文件失败。')
    } finally {
      sessionLoading.value = false
    }
  }
  function selectFile(path: string) {
    if (!isWorkspaceBusy.value) activePath.value = path
  }
  function renameFile(index: number, path: string) {
    if (isWorkspaceBusy.value || !files.value[index]) return
    if (!path.trim() || files.value.some((f, i) => i !== index && f.path === path)) {
      workspaceError.value = '文件路径不能为空或重复。'
      return
    }
    const old = files.value[index]!.path
    files.value[index]!.path = path
    if (activePath.value === old) activePath.value = path
  }
  function removeFile(index: number) {
    if (isWorkspaceBusy.value || files.value.length <= 1) return
    files.value.splice(index, 1)
    if (!files.value.some((f) => f.path === activePath.value))
      activePath.value = files.value[0]!.path
  }

  function clearWorkspace() {
    if (isWorkspaceBusy.value) return
    code.value = ''
    sourceSnapshot.value = null
    resetOutput()
    followUpQuestion.value = ''
    followUpMessages.value = []
    followUpStatus.value = 'idle'
  }

  function handleLanguageChange(language: SupportedLanguage) {
    if (!isWorkspaceBusy.value) setDetectedLanguage(language)
  }
  /** 将图节点关联回快照文件并切换编辑目标，页面等待更新后再执行滚动高亮。 */
  function primeFollowUpQuestionFromNode(nodeId: string): NodeMapping | undefined {
    if (sourceChanged.value || isWorkspaceBusy.value) return
    const mapping = mappings.value.find((item) => item.nodeId === nodeId)
    if (mapping) {
      const fileId = (mapping as Partial<MultiFileMapping>).fileId
      if (fileId && multiSnapshot.value) {
        const path = mappingFilePath(fileId, multiSnapshot.value, files.value)
        if (!path) return
        activePath.value = path
      }
      followUpQuestion.value = `为什么节点「${mapping.label}」会被画成 ${mapping.kind} 类型？它对应的第 ${mapping.lineStart}-${mapping.lineEnd} 行逻辑在流程图里为什么这样连接？`
    }
    return mapping
  }
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    preference('code2flow.sidebar-collapsed', String(sidebarCollapsed.value))
  }

  onMounted(async () => {
    void getHealth()
      .then((health) => {
        healthStatus.value = health.ok ? 'online' : 'offline'
      })
      .catch(() => {
        healthStatus.value = 'offline'
      })
    try {
      await refreshSessions()
      if (listError.value) throw new Error(listError.value)
      const previous = preference(ACTIVE_SESSION_KEY)
      const candidate =
        sessions.value.find((item) => item.id === previous) ??
        sessions.value.find((item) => !item.busy)
      if (candidate && !candidate.busy)
        await applySession(await sessionApi.getSession(candidate.id))
      else await saveDraft()
    } catch (error) {
      if (!persisted) saveStatus.value = 'error'
      workspaceError.value = message(error, '初始化会话失败，请重试保存或刷新列表。')
    } finally {
      applying = false
      sessionLoading.value = false
    }
  })
  onBeforeUnmount(() => {
    alive = false
    cancelGeneration()
    if (saveTimer) clearTimeout(saveTimer)
  })

  return {
    files,
    pendingFiles,
    confirmUploadFiles,
    activePath,
    multiResult,
    handleUploadFiles,
    selectFile,
    renameFile,
    removeFile,
    cancelGeneration,
    failRendering,
    documentId: computed(() =>
      files.value.length ? fileDocumentId(activePath.value) : `${threadId.value}/input`
    ),
    documentIds: computed(() =>
      files.value.length
        ? files.value.map((f) => fileDocumentId(f.path))
        : [`${threadId.value}/input`]
    ),
    code,
    healthStatus,
    uploadFileName,
    threadId,
    sessionTitle,
    sessions,
    sessionSearch,
    sessionLoading,
    listLoading,
    listError,
    sidebarCollapsed,
    filteredSessions,
    followUpQuestion,
    followUpMessages,
    followUpStatus,
    isWorkspaceBusy,
    sourceChanged,
    canAskFollowUp,
    errorMessage: combinedErrorMessage,
    detectedLanguage,
    isLoading,
    mappings,
    mermaid,
    statusText,
    lineCount,
    saveStatus,
    saveStatusText,
    refreshSessions,
    selectSession,
    resetSession: () => startSession(),
    loadSample: () => startSession(SAMPLE_CODE, '示例代码.js', 'javascript'),
    renameSession,
    removeSession,
    retrySave,
    handleGenerate,
    handleFollowUp,
    handleUploadFile,
    clearWorkspace,
    handleLanguageChange,
    primeFollowUpQuestionFromNode,
    toggleSidebar
  }
}
