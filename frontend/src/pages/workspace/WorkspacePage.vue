<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { CodeEditorExpose } from '../../features/code-editor/model/types'
import CodeEditor from '../../features/code-editor/ui/CodeEditor.vue'
import FlowDiagram from '../../features/flow-diagram/ui/FlowDiagram.vue'
import SessionSidebar from '../../features/workspace/ui/SessionSidebar.vue'
import ChunkDebugPage from '../debug/ChunkDebugPage.vue'
import { useWorkspacePage } from '../../features/workspace/model/useWorkspacePage'
import { CODE_FILE_ACCEPT } from '../../entities/flow/model/languages'

const emit = defineEmits<{ 'open-evaluation': [] }>()

const editorRef = ref<CodeEditorExpose | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const renameDialog = ref<HTMLDialogElement | null>(null)
const deleteDialog = ref<HTMLDialogElement | null>(null)
const renameTitle = ref('')
const debugOpen = ref(false)
const byteSize = (content: string) => new TextEncoder().encode(content).byteLength
const {
  code,
  hasCode,
  files,
  activePath,
  multiResult,
  snapshotId,
  waitingForSnapshotChunks,
  documentId,
  documentIds,
  handleUploadFiles,
  selectFile,
  renameFile,
  removeFile,
  cancelGeneration,
  handleRenderError,
  healthStatus,
  threadId,
  sessionTitle,
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
  errorMessage,
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
  resetSession,
  loadSample,
  renameSession,
  removeSession,
  retrySave,
  handleGenerate,
  handleFollowUp,
  clearWorkspace,
  handleLanguageChange,
  primeFollowUpQuestionFromNode,
  toggleSidebar
} = useWorkspacePage()

async function handleFileChange(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  const input = event.target
  await handleUploadFiles(input.files)
  input.value = ''
}
async function handleSelectNode(nodeId: string) {
  const mapping = primeFollowUpQuestionFromNode(nodeId)
  if (!mapping) return
  await nextTick()
  editorRef.value?.focusMapping(mapping)
}
function openRename() {
  renameTitle.value = sessionTitle.value
  renameDialog.value?.showModal()
}
async function submitRename() {
  if (!renameTitle.value.trim()) return
  renameDialog.value?.close()
  await renameSession(renameTitle.value)
}
async function confirmDelete() {
  deleteDialog.value?.close()
  await removeSession()
}
</script>

<template>
  <div
    class="app-shell session-workbench"
    :class="{ 'sidebar-is-collapsed': sidebarCollapsed }"
  >
    <SessionSidebar
      :collapsed="sidebarCollapsed"
      :sessions="filteredSessions"
      :active-id="threadId"
      :search="sessionSearch"
      :loading="listLoading"
      :error="listError"
      :busy="isWorkspaceBusy"
      :debug-open="debugOpen"
      @toggle="toggleSidebar"
      @create="debugOpen = false; resetSession()"
      @select="debugOpen = false; selectSession($event)"
      @refresh="refreshSessions"
      @toggle-debug="debugOpen = !debugOpen"
      @open-evaluation="emit('open-evaluation')"
      @update:search="sessionSearch = $event"
    />

    <ChunkDebugPage
      v-show="debugOpen"
      :open="debugOpen"
      :files="files"
      :session-id="threadId"
      :snapshot-id="snapshotId"
      :source-changed="sourceChanged"
      :waiting-for-snapshot-chunks="waitingForSnapshotChunks"
      :busy="sessionLoading"
      @back="debugOpen = false"
    />
    <section
      v-show="!debugOpen"
      class="workspace-stage session-workspace"
      :aria-busy="sessionLoading"
    >
      <header class="session-header">
        <div class="session-heading-copy">
          <span class="session-breadcrumb">会话 <span>/</span></span>
          <h1 :title="sessionTitle">
            {{ sessionTitle }}
          </h1>
        </div>
        <span
          class="session-save-state"
          role="status"
          :data-state="saveStatus"
        >{{
          saveStatusText
        }}</span>
        <span
          v-if="sessionLoading && !isLoading"
          class="session-loading-notice"
          role="status"
        >
          正在处理会话…
        </span>
        <div class="session-header-actions">
          <button
            v-if="saveStatus === 'error'"
            type="button"
            class="ghost-button"
            :disabled="isWorkspaceBusy"
            @click="retrySave"
          >
            重试保存
          </button>
          <button
            type="button"
            class="ghost-button"
            :disabled="isWorkspaceBusy"
            @click="openRename"
          >
            <svg
              class="ui-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5" />
            </svg>
            重命名
          </button>
          <button
            type="button"
            class="ghost-button session-delete-button"
            :disabled="isWorkspaceBusy"
            @click="deleteDialog?.showModal()"
          >
            <svg
              class="ui-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
            </svg>
            删除
          </button>
        </div>
      </header>
      <p
        v-if="errorMessage"
        class="error-banner"
        role="alert"
      >
        {{ errorMessage }}
      </p>
      <p
        v-if="sourceChanged"
        class="source-changed-notice"
        role="status"
      >
        源码已修改，请重新生成流程图后再定位节点或追问。
      </p>
      <div class="workspace-shell session-panels">
        <section class="editor-panel panel workspace-shell-card">
          <input
            ref="fileInputRef"
            class="sr-only-input"
            type="file"
            multiple
            :accept="CODE_FILE_ACCEPT"
            :disabled="isWorkspaceBusy"
            @change="handleFileChange"
          >
          <div
            v-if="files.length"
            class="multi-file-list"
            aria-label="本次分析文件，生成前可调整相对路径"
          >
            <p>
              共 {{ files.length }} 个文件；可调整相对路径。源码也会发送至已配置的 Embedding 服务。
            </p>
            <div
              v-for="(file, index) in files"
              :key="index"
              class="multi-file-row"
            >
              <button
                type="button"
                class="ghost-button"
                :aria-pressed="activePath === file.path"
                :disabled="isWorkspaceBusy"
                @click="selectFile(file.path)"
              >
                编辑
              </button>
              <input
                :value="file.path"
                :disabled="isWorkspaceBusy"
                aria-label="项目内相对路径"
                @change="renameFile(index, ($event.target as HTMLInputElement).value)"
              >
              <span>{{ byteSize(file.content) }} B</span>
              <button
                type="button"
                class="ghost-button"
                :disabled="isWorkspaceBusy || files.length < 2"
                @click="removeFile(index)"
              >
                移除
              </button>
            </div>
          </div>
          <button
            v-if="isLoading"
            type="button"
            class="ghost-button"
            @click="cancelGeneration"
          >
            取消分析
          </button>
          <CodeEditor
            ref="editorRef"
            v-model="code"
            :document-id="documentId"
            :document-ids="documentIds"
            :language="detectedLanguage"
            :disabled="isWorkspaceBusy"
            @update:language="handleLanguageChange"
          >
            <template #file-actions>
              <div class="editor-file-actions">
                <button
                  type="button"
                  class="primary-chip-button"
                  :disabled="isWorkspaceBusy"
                  @click="fileInputRef?.click()"
                >
                  <svg
                    class="ui-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5" />
                  </svg>
                  上传文件
                </button>
                <button
                  type="button"
                  class="ghost-button"
                  :disabled="isWorkspaceBusy"
                  @click="loadSample"
                >
                  <svg
                    class="ui-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16h16V8ZM14 2v6h6M8 12h8M8 16h6" />
                  </svg>
                  导入示例
                </button>
                <button
                  type="button"
                  class="ghost-button editor-clear-button"
                :disabled="isWorkspaceBusy || !files.length"
                  @click="clearWorkspace"
                >
                  <svg
                    class="ui-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
                  </svg>
                  清空
                </button>
              </div>
            </template>
            <template #generate-action>
              <button
                type="button"
                class="hero-run-button"
                :disabled="isWorkspaceBusy || !hasCode"
                @click="handleGenerate"
              >
                <svg
                  class="ui-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path
                    d="M12 7v5M5 16v-4h14v4M9 2h6v5H9ZM2 16h6v5H2ZM16 16h6v5h-6Z"
                  />
                </svg>
                {{ isLoading ? '生成中…' : '生成流程图' }}
              </button>
            </template>
          </CodeEditor>
        </section>
        <section class="analysis-panel">
          <section
            class="panel diagram-panel workspace-shell-card"
            :class="{ 'diagram-source-stale': sourceChanged }"
          >
            <p
              v-if="multiResult && !multiResult.hasExecutableFlow"
              class="session-message-empty"
            >
              已完成全部文件分析；没有可展示的执行流程。
            </p>
            <FlowDiagram
              v-else-if="mermaid"
              :mermaid="mermaid"
              :mappings="sourceChanged ? [] : mappings"
              :is-streaming="isLoading"
              @select-node="handleSelectNode"
              @render-error="handleRenderError"
            />
            <p
              v-else
              class="session-message-empty"
            >
              {{ isLoading ? statusText : '等待分析结果' }}
            </p>
            <p v-if="multiResult" class="multi-diagnostics-count">
              诊断条数 {{ multiResult.diagnostics.length }}
            </p>
            <ul
              v-if="multiResult?.diagnostics.length"
              class="multi-diagnostics"
            >
              <li
                v-for="(diagnostic, index) in multiResult.diagnostics"
                :key="index"
              >
                {{ diagnostic.message }}
              </li>
            </ul>
          </section>
          <section class="panel session-followup-panel workspace-shell-card">
            <div class="panel-header">
              <div>
                <h2>追问解释</h2>
              </div>
            </div>
            <div
              class="session-messages"
              role="log"
              aria-label="当前会话问答"
              :aria-busy="followUpStatus === 'loading'"
            >
              <p
                v-if="!followUpMessages.length"
                class="session-message-empty"
              >
                {{
                  canAskFollowUp
                    ? '点击图中节点，或输入问题了解当前代码。'
                    : sourceChanged
                      ? '源码已变更，请重新生成后再追问。'
                      : '生成流程图后，可围绕当前代码继续追问。'
                }}
              </p>
              <article
                v-for="(item, index) in followUpMessages"
                :key="index"
                class="session-message"
                :class="`message-${item.role}`"
              >
                <span
                  class="message-avatar"
                  :title="item.role === 'user' ? '你' : 'Code2Flow'"
                ><svg
                  class="ui-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  aria-hidden="true"
                >
                  <path
                    v-if="item.role === 'user'"
                    d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3Z"
                  />
                  <path
                    v-else
                    d="M9 3h6v5H9ZM5 8h14v13H5ZM9 12v3M15 12v3M9 18h6"
                  /></svg></span>
                <p>{{ item.content }}</p>
              </article>
              <p
                v-if="followUpStatus === 'loading'"
                class="session-message-empty"
                role="status"
              >
                正在解释…
              </p>
            </div>
            <form
              class="session-question-form"
              @submit.prevent="handleFollowUp"
            >
              <textarea
                v-model="followUpQuestion"
                rows="1"
                :disabled="!canAskFollowUp"
                aria-label="追问当前源码与流程图"
                placeholder="围绕当前代码继续追问…"
              />
              <button
                type="submit"
                class="ghost-button"
                :disabled="!canAskFollowUp || !followUpQuestion.trim()"
              >
                <span class="sr-only-input">{{
                  followUpStatus === 'loading' ? '解释中…' : '发送'
                }}</span><svg
                  class="ui-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m4 3 17 9-17 9 4-9ZM8 12h13" />
                </svg>
              </button>
            </form>
          </section>
        </section>
      </div>
      <footer class="workspace-statusbar">
        <span>{{ detectedLanguage === 'unknown' ? '未确定语言' : detectedLanguage }} ·
          {{ lineCount }} 行 · {{ statusText }}</span>
        <span><i
          class="workspace-service-dot"
          :class="{ 'service-online': healthStatus === 'online' }"
        />{{
          healthStatus === 'online'
            ? '服务在线'
            : healthStatus === 'checking'
              ? '检查服务…'
              : '服务离线'
        }}
          · 本机会话</span>
      </footer>
    </section>

    <dialog
      ref="renameDialog"
      class="session-confirm-dialog"
      aria-labelledby="rename-title"
    >
      <form @submit.prevent="submitRename">
        <h2 id="rename-title">
          重命名会话
        </h2>
        <label for="session-title-input">会话名称</label>
        <input
          id="session-title-input"
          v-model="renameTitle"
          maxlength="100"
          required
          autofocus
        >
        <div>
          <button
            type="button"
            class="ghost-button"
            @click="renameDialog?.close()"
          >
            取消
          </button><button
            type="submit"
            class="primary-chip-button"
            :disabled="!renameTitle.trim()"
          >
            保存
          </button>
        </div>
      </form>
    </dialog>
    <dialog
      ref="deleteDialog"
      class="session-confirm-dialog"
      aria-labelledby="delete-title"
    >
      <h2 id="delete-title">
        删除当前会话？
      </h2>
      <p>将删除「{{ sessionTitle }}」的草稿、分析检查点和问答记录，此操作无法撤销。</p>
      <div>
        <button
          type="button"
          class="ghost-button"
          @click="deleteDialog?.close()"
        >
          取消
        </button><button
          type="button"
          class="ghost-button session-delete-button"
          @click="confirmDelete"
        >
          删除会话
        </button>
      </div>
    </dialog>
  </div>
</template>

<style src="./workspace.css"></style>
