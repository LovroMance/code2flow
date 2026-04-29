<script setup lang="ts">
import { ref } from 'vue'
import type { CodeEditorExpose } from '../../features/code-editor/model/types'
import CodeEditor from '../../features/code-editor/ui/CodeEditor.vue'
import FlowDiagram from '../../features/flow-diagram/ui/FlowDiagram.vue'
import { useWorkspacePage } from '../../features/workspace/model/useWorkspacePage'

const editorRef = ref<CodeEditorExpose | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const {
  code,
  detectedLanguage,
  errorMessage,
  followUpAnswer,
  followUpQuestion,
  followUpStatus,
  followUpStatusText,
  handleGenerate,
  handleFollowUp,
  handleLanguageChange,
  handleUploadFile,
  healthStatus,
  isLoading,
  canAskFollowUp,
  loadSample,
  mappings,
  mermaid,
  resetSession,
  status,
  statusText,
  threadId,
  threadLabel,
  clearWorkspace,
  findMappingByNodeId,
  primeFollowUpQuestionFromNode,
  uploadFileName
} = useWorkspacePage()

function openFilePicker() {
  fileInputRef.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target

  if (!(input instanceof HTMLInputElement)) {
    return
  }

  const [file] = Array.from(input.files ?? [])
  await handleUploadFile(file)
  input.value = ''
}

function handleSelectNode(nodeId: string) {
  const mapping = primeFollowUpQuestionFromNode(nodeId) ?? findMappingByNodeId(nodeId)
  if (!mapping) {
    return
  }

  editorRef.value?.focusMapping(mapping)
}
</script>

<template>
  <div class="app-shell">
    <section class="workspace-stage">
      <p v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
      </p>

      <section class="hero-panel">
        <input
          ref="fileInputRef"
          class="sr-only-input"
          type="file"
          accept=".js,.ts,.vue,.jsx,.tsx,.java,.c,.cpp,.h,.hpp,.py,.go,.rs,.cs,.php,text/plain"
          @change="handleFileChange"
        />
        <div class="hero-copy">
          <p class="hero-kicker">Analysis Command Deck</p>
          <h1>CODE2FLOW</h1>
          <div class="topbar-status-line hero-status-line">
            <span class="micro-pill">Stage {{ '01' }}</span>
            <span class="micro-pill" :class="{ 'micro-pill-active': status !== 'idle' }">
              Agent {{ statusText }}
            </span>
            <span class="micro-pill" :class="{ 'micro-pill-active': healthStatus === 'online' }">
              Backend {{ healthStatus }}
            </span>
          </div>
          <p class="hero-body">
            Upload source, inspect the detected language, and let Code2Flow turn control paths into
            a renderable diagram without leaving the workspace.
          </p>
        </div>

        <div class="hero-cta-row">
          <div class="hero-action-group">
            <button class="primary-chip-button" type="button" @click="openFilePicker">
              {{ uploadFileName ? 'Replace Source File' : 'Upload Source File' }}
            </button>
            <button class="ghost-button" type="button" @click="resetSession">新建会话</button>
            <button class="ghost-button" type="button" @click="loadSample">导入示例</button>
            <button class="ghost-button" type="button" @click="clearWorkspace">清空画布</button>
          </div>
          <button
            class="hero-run-button"
            type="button"
            :disabled="isLoading || !code.trim()"
            @click="handleGenerate"
          >
            {{ isLoading ? '生成中...' : '生成流程图' }}
          </button>
        </div>

        <div class="hero-metrics">
          <article class="metric-card hover-card">
            <span class="metric-label">Source</span>
            <strong class="metric-title">
              {{ uploadFileName ? uploadFileName : 'Direct Input Mode' }}
            </strong>
            <span class="metric-value" :class="{ 'metric-value-active': !!uploadFileName }">
              {{ uploadFileName ? 'File imported' : 'Paste or upload code' }}
            </span>
          </article>

          <article class="metric-card hover-card">
            <span class="metric-label">Language Sync</span>
            <strong class="metric-title">{{ detectedLanguage }}</strong>
            <span class="metric-value metric-value-active">Auto synced with Monaco</span>
          </article>

          <article class="metric-card hover-card">
            <span class="metric-label">Session Thread</span>
            <strong class="metric-title">#{{ threadLabel }}</strong>
            <span class="metric-value" :class="{ 'metric-value-active': status !== 'idle' }">
              {{ status !== 'idle' ? 'Streaming on current thread' : 'Ready on current thread' }}
            </span>
          </article>
        </div>
      </section>

      <main class="workspace-shell">
        <section class="editor-panel panel workspace-shell-card">
          <div class="panel-header panel-header-compact">
            <div>
              <p class="panel-kicker">Input</p>
              <h2>代码输入区</h2>
            </div>
            <span class="badge badge-active">
              {{
                uploadFileName
                  ? `Imported · ${detectedLanguage}`
                  : `Monaco Ready · ${detectedLanguage}`
              }}
            </span>
          </div>
          <CodeEditor
            ref="editorRef"
            v-model="code"
            :language="detectedLanguage"
            @update:language="handleLanguageChange"
          />
        </section>

        <section class="analysis-panel">
          <section class="panel diagram-panel workspace-shell-card">
            <div class="panel-header panel-header-compact">
              <div>
                <p class="panel-kicker">Output Device</p>
                <h2>流程图输出区</h2>
              </div>
              <span class="badge" :class="{ 'badge-active': status !== 'idle' }">
                {{ statusText }}
              </span>
            </div>
            <div class="diagram-device-copy">
              <span class="diagram-device-label">Live Render · {{ threadId.slice(0, 8) }}</span>
              <p>Mermaid stream, node mapping, and editor linkage stay intact inside the device.</p>
            </div>
            <FlowDiagram :mermaid="mermaid" :mappings="mappings" @select-node="handleSelectNode" />
          </section>

          <section class="panel followup-panel workspace-shell-card">
            <div class="panel-header panel-header-compact">
              <div>
                <p class="panel-kicker">Follow-up</p>
                <h2>追问解释区</h2>
              </div>
              <span class="badge" :class="{ 'badge-active': followUpStatus !== 'idle' }">
                {{ followUpStatusText }}
              </span>
            </div>
            <div class="followup-panel-copy">
              <span class="diagram-device-label">Thread · {{ threadLabel }}</span>
              <p>在当前会话里追问某个分支、节点或异步链路为什么这样建图。</p>
            </div>
            <textarea
              v-model="followUpQuestion"
              class="followup-textarea"
              rows="4"
              placeholder="例如：为什么这里的 if 被拆成两个节点？这个异步分支为什么单独建图？"
            />
            <div class="followup-actions">
              <button
                class="ghost-button"
                type="button"
                :disabled="!canAskFollowUp || !followUpQuestion.trim()"
                @click="handleFollowUp"
              >
                {{ followUpStatus === 'loading' ? '解释中...' : '提交追问' }}
              </button>
            </div>
            <div class="followup-answer" :class="{ 'followup-answer-active': !!followUpAnswer }">
              <p v-if="followUpAnswer">{{ followUpAnswer }}</p>
              <p v-else>先生成流程图，再基于当前 thread 提一个具体问题。</p>
            </div>
          </section>
        </section>
      </main>
    </section>
  </div>
</template>
