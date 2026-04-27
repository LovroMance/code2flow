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
  handleGenerate,
  handleLanguageChange,
  handleUploadFile,
  healthStatus,
  isLoading,
  loadSample,
  mappings,
  mermaid,
  status,
  statusText,
  clearWorkspace,
  findMappingByNodeId,
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
  const mapping = findMappingByNodeId(nodeId)
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
            <span class="metric-label">Run State</span>
            <strong class="metric-title">SSE + LangChain</strong>
            <span class="metric-value" :class="{ 'metric-value-active': status !== 'idle' }">
              {{ status !== 'idle' ? 'Streaming active' : 'Ready to generate' }}
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
              <span class="diagram-device-label">Live Render</span>
              <p>Mermaid stream, node mapping, and editor linkage stay intact inside the device.</p>
            </div>
            <FlowDiagram :mermaid="mermaid" :mappings="mappings" @select-node="handleSelectNode" />
          </section>
        </section>
      </main>
    </section>
  </div>
</template>
