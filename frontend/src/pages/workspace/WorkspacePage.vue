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
  errorMessage,
  handleGenerate,
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
      <header class="topbar">
        <div class="topbar-identity">
          <p class="eyebrow">Code2Flow</p>
          <div class="topbar-title-row">
            <h1>代码流程分析台</h1>
            <div class="topbar-status-line">
              <span class="micro-pill">阶段 {{ 'Stage 1' }}</span>
              <span class="micro-pill" :class="{ 'micro-pill-active': status !== 'idle' }">
                Agent {{ statusText }}
              </span>
              <span class="micro-pill" :class="{ 'micro-pill-active': healthStatus === 'online' }">
                Backend {{ healthStatus }}
              </span>
            </div>
          </div>
        </div>

        <div class="topbar-actions">
          <input
            ref="fileInputRef"
            class="sr-only-input"
            type="file"
            accept=".js,.ts,.vue,.jsx,.tsx,.java,.c,.cpp,.h,.hpp,.py,.go,.rs,.cs,.php,text/plain"
            @change="handleFileChange"
          />
          <button class="ghost-button" type="button" @click="openFilePicker">上传代码文件</button>
          <button class="ghost-button" type="button" @click="loadSample">导入示例</button>
          <button class="ghost-button" type="button" @click="clearWorkspace">清空画布</button>
          <button
            class="primary-button"
            type="button"
            :disabled="isLoading || !code.trim()"
            @click="handleGenerate"
          >
            {{ isLoading ? '生成中...' : '生成流程图' }}
          </button>
        </div>
      </header>

      <p v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
      </p>

      <main class="workspace-shell">
        <section class="editor-panel panel">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">Input</p>
              <h2>代码输入区</h2>
            </div>
            <span class="badge badge-active">
              {{ uploadFileName ? `已导入 ${uploadFileName}` : 'Monaco Ready' }}
            </span>
          </div>
          <CodeEditor ref="editorRef" v-model="code" />
        </section>

        <section class="analysis-panel">
          <section class="panel diagram-panel">
            <div class="panel-header">
              <div>
                <p class="panel-kicker">Diagram</p>
                <h2>流程图输出区</h2>
              </div>
              <span class="badge" :class="{ 'badge-active': status !== 'idle' }">
                {{ statusText }}
              </span>
            </div>
            <FlowDiagram :mermaid="mermaid" :mappings="mappings" @select-node="handleSelectNode" />
          </section>
        </section>
      </main>
    </section>
  </div>
</template>
