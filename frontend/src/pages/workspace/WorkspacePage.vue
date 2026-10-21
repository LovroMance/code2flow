<script setup lang="ts">
import { ref } from 'vue'
import type { CodeEditorExpose } from '../../features/code-editor/model/types'
import CodeEditor from '../../features/code-editor/ui/CodeEditor.vue'
import FlowDiagram from '../../features/flow-diagram/ui/FlowDiagram.vue'
import SessionSidebar from '../../features/workspace/ui/SessionSidebar.vue'
import { useWorkspacePage } from '../../features/workspace/model/useWorkspacePage'
import { CODE_FILE_ACCEPT } from '../../entities/flow/model/languages'

const editorRef = ref<CodeEditorExpose | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const renameDialog = ref<HTMLDialogElement | null>(null)
const deleteDialog = ref<HTMLDialogElement | null>(null)
const renameTitle = ref('')
const {
  code,
  healthStatus,
  uploadFileName,
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
  handleUploadFile,
  clearWorkspace,
  handleLanguageChange,
  primeFollowUpQuestionFromNode,
  toggleSidebar
} = useWorkspacePage()

async function handleFileChange(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  const input = event.target
  await handleUploadFile(input.files?.[0])
  input.value = ''
}
function handleSelectNode(nodeId: string) {
  const mapping = primeFollowUpQuestionFromNode(nodeId)
  if (!mapping) return
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
  <div class="app-shell session-workbench" :class="{ 'sidebar-is-collapsed': sidebarCollapsed }">
    <SessionSidebar
      :collapsed="sidebarCollapsed"
      :sessions="filteredSessions"
      :active-id="threadId"
      :search="sessionSearch"
      :loading="listLoading"
      :error="listError"
      :busy="isWorkspaceBusy"
      @toggle="toggleSidebar"
      @create="resetSession"
      @select="selectSession"
      @refresh="refreshSessions"
      @update:search="sessionSearch = $event"
    />

    <section class="workspace-stage session-workspace" :aria-busy="sessionLoading">
      <header class="session-header">
        <div class="session-heading-copy">
          <h1 :title="sessionTitle">
            {{ sessionTitle }}
          </h1>
          <p :title="threadId">
            {{ uploadFileName || '直接输入' }} <span>· #{{ threadId.slice(0, 8) }}</span>
          </p>
        </div>
        <div class="session-header-actions">
          <span class="session-save-state" role="status">{{ saveStatusText }}</span>
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
            重命名
          </button>
          <button
            type="button"
            class="ghost-button session-delete-button"
            :disabled="isWorkspaceBusy"
            @click="deleteDialog?.showModal()"
          >
            删除
          </button>
        </div>
      </header>
      <p v-if="errorMessage" class="error-banner" role="alert">
        {{ errorMessage }}
      </p>
      <p v-if="sourceChanged" class="source-changed-notice" role="status">
        源码已修改，请重新生成流程图后再定位节点或追问。
      </p>
      <p v-if="sessionLoading && !isLoading" class="session-loading-notice" role="status">
        正在处理会话，请稍候…
      </p>
      <div class="workspace-shell session-panels">
        <section class="editor-panel panel workspace-shell-card">
          <input
            ref="fileInputRef"
            class="sr-only-input"
            type="file"
            :accept="CODE_FILE_ACCEPT"
            :disabled="isWorkspaceBusy"
            @change="handleFileChange"
          />
          <div class="panel-header">
            <div>
              <h2>代码编辑器</h2>
              <span class="panel-kicker">SOURCE</span>
            </div>
            <button
              type="button"
              class="hero-run-button"
              :disabled="isWorkspaceBusy || !code.trim()"
              @click="handleGenerate"
            >
              {{ isLoading ? '生成中…' : '生成流程图' }}
            </button>
          </div>
          <div class="editor-file-actions">
            <button
              type="button"
              class="primary-chip-button"
              :disabled="isWorkspaceBusy"
              @click="fileInputRef?.click()"
            >
              {{ uploadFileName ? '替换代码文件' : '上传代码文件' }}
            </button>
            <button
              type="button"
              class="ghost-button"
              :disabled="isWorkspaceBusy"
              @click="loadSample"
            >
              导入示例
            </button>
            <button
              type="button"
              class="ghost-button editor-clear-button"
              :disabled="isWorkspaceBusy || !code"
              @click="clearWorkspace"
            >
              清空源码
            </button>
          </div>
          <CodeEditor
            :key="threadId"
            ref="editorRef"
            v-model="code"
            :document-id="threadId"
            :language="detectedLanguage"
            :disabled="isWorkspaceBusy"
            @update:language="handleLanguageChange"
          />
        </section>
        <section class="analysis-panel">
          <section
            class="panel diagram-panel workspace-shell-card"
            :class="{ 'diagram-source-stale': sourceChanged }"
          >
            <div class="panel-header">
              <div>
                <h2>流程图</h2>
                <span class="panel-kicker">FLOW</span>
              </div>
              <span
                class="badge"
                :class="{ 'badge-active': !sourceChanged && statusText === '已生成' }"
                >{{ sourceChanged ? '待重新生成' : statusText }}</span
              >
            </div>
            <FlowDiagram
              :mermaid="mermaid"
              :mappings="sourceChanged ? [] : mappings"
              :is-streaming="isLoading"
              @select-node="handleSelectNode"
            />
          </section>
          <section class="panel session-followup-panel workspace-shell-card">
            <div class="panel-header">
              <div>
                <h2>追问解释</h2>
                <span class="panel-kicker">ASK</span>
              </div>
              <span class="session-context-label">当前会话上下文</span>
            </div>
            <div
              class="session-messages"
              role="log"
              aria-label="当前会话问答"
              :aria-busy="followUpStatus === 'loading'"
            >
              <p v-if="!followUpMessages.length" class="session-message-empty">
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
                <span>{{ item.role === 'user' ? '你' : 'Code2Flow' }}</span>
                <p>{{ item.content }}</p>
              </article>
              <p v-if="followUpStatus === 'loading'" class="session-message-empty" role="status">
                正在解释…
              </p>
            </div>
            <form class="session-question-form" @submit.prevent="handleFollowUp">
              <textarea
                v-model="followUpQuestion"
                rows="2"
                :disabled="!canAskFollowUp"
                aria-label="追问当前源码与流程图"
                placeholder="围绕当前源码和流程图继续追问…"
              />
              <button
                type="submit"
                class="ghost-button"
                :disabled="!canAskFollowUp || !followUpQuestion.trim()"
              >
                {{ followUpStatus === 'loading' ? '解释中…' : '发送' }}
              </button>
            </form>
          </section>
        </section>
      </div>
      <footer class="workspace-statusbar">
        <span
          >{{ detectedLanguage === 'unknown' ? '未确定语言' : detectedLanguage }} ·
          {{ lineCount }} 行 · {{ statusText }}</span
        >
        <span
          ><i
            class="workspace-service-dot"
            :class="{ 'service-online': healthStatus === 'online' }"
          />{{
            healthStatus === 'online'
              ? '服务在线'
              : healthStatus === 'checking'
                ? '检查服务…'
                : '服务离线'
          }}
          · 本机会话</span
        >
      </footer>
    </section>

    <dialog ref="renameDialog" class="session-confirm-dialog" aria-labelledby="rename-title">
      <form @submit.prevent="submitRename">
        <h2 id="rename-title">重命名会话</h2>
        <label for="session-title-input">会话名称</label>
        <input id="session-title-input" v-model="renameTitle" maxlength="100" required autofocus />
        <div>
          <button type="button" class="ghost-button" @click="renameDialog?.close()">取消</button
          ><button type="submit" class="primary-chip-button" :disabled="!renameTitle.trim()">
            保存
          </button>
        </div>
      </form>
    </dialog>
    <dialog ref="deleteDialog" class="session-confirm-dialog" aria-labelledby="delete-title">
      <h2 id="delete-title">删除当前会话？</h2>
      <p>将删除「{{ sessionTitle }}」的草稿、分析检查点和问答记录，此操作无法撤销。</p>
      <div>
        <button type="button" class="ghost-button" @click="deleteDialog?.close()">取消</button
        ><button type="button" class="ghost-button session-delete-button" @click="confirmDelete">
          删除会话
        </button>
      </div>
    </dialog>
  </div>
</template>

<style src="./workspace.css"></style>
