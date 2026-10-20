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
          <p class="hero-kicker">代码流程分析工作区</p>
          <h1>Code2Flow</h1>
          <div class="topbar-status-line hero-status-line">
            <span class="micro-pill">阶段 {{ '01' }}</span>
            <span class="micro-pill" :class="{ 'micro-pill-active': status !== 'idle' }">
              分析 {{ statusText }}
            </span>
            <span class="micro-pill" :class="{ 'micro-pill-active': healthStatus === 'online' }">
              服务 {{ healthStatus }}
            </span>
          </div>
          <p class="hero-body">输入代码，生成流程图，点击节点定位源码。</p>
        </div>

        <div class="hero-cta-row">
          <div class="hero-action-group">
            <button class="primary-chip-button" type="button" @click="openFilePicker">
              {{ uploadFileName ? '替换代码文件' : '上传代码文件' }}
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
            <span class="metric-label">代码来源</span>
            <strong class="metric-title" :title="uploadFileName">
              {{ uploadFileName ? uploadFileName : '直接输入' }}
            </strong>
            <span class="metric-value" :class="{ 'metric-value-active': !!uploadFileName }">
              {{ uploadFileName ? '已导入文件' : '支持粘贴或上传' }}
            </span>
          </article>

          <article class="metric-card hover-card">
            <span class="metric-label">当前语言</span>
            <strong class="metric-title">{{ detectedLanguage }}</strong>
            <span class="metric-value metric-value-active">已同步编辑器</span>
          </article>

          <article class="metric-card hover-card">
            <span class="metric-label">当前会话</span>
            <strong class="metric-title" :title="threadId">#{{ threadLabel }}</strong>
            <span class="metric-value" :class="{ 'metric-value-active': status !== 'idle' }">
              {{ status !== 'idle' ? '使用当前会话分析' : '会话已就绪' }}
            </span>
          </article>
        </div>
      </section>

      <main class="workspace-shell">
        <section class="editor-panel panel workspace-shell-card">
          <div class="panel-header panel-header-compact">
            <div>
              <p class="panel-kicker">SOURCE</p>
              <h2>代码编辑器</h2>
            </div>
            <span class="badge badge-active">
              {{
                uploadFileName ? `已导入 · ${detectedLanguage}` : `编辑器就绪 · ${detectedLanguage}`
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
                <p class="panel-kicker">FLOW</p>
                <h2>流程图</h2>
              </div>
              <span class="badge" :class="{ 'badge-active': status !== 'idle' }">
                {{ statusText }}
              </span>
            </div>
            <div class="diagram-device-copy">
              <span class="diagram-device-label" :title="threadId"
                >实时预览 · {{ threadId.slice(0, 8) }}</span
              >
              <p>点击节点定位源码 · 支持流式预览与行号映射</p>
            </div>
            <FlowDiagram :mermaid="mermaid" :mappings="mappings" @select-node="handleSelectNode" />
          </section>

          <section class="panel followup-panel workspace-shell-card">
            <div class="panel-header panel-header-compact">
              <div>
                <p class="panel-kicker">ASK</p>
                <h2>追问解释</h2>
              </div>
              <span class="badge" :class="{ 'badge-active': followUpStatus !== 'idle' }">
                {{ followUpStatusText }}
              </span>
            </div>
            <div class="followup-panel-copy">
              <span class="diagram-device-label" :title="threadId">会话 · {{ threadLabel }}</span>
              <p>选中节点或输入问题，了解分支与异步逻辑。</p>
            </div>
            <textarea
              v-model="followUpQuestion"
              class="followup-textarea"
              rows="4"
              placeholder="例如：为什么这个分支单独建图？点击图中节点也可预填问题。"
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
              <p v-else>生成流程图后，在这里查看当前会话的解释。</p>
            </div>
          </section>
        </section>
      </main>
    </section>
  </div>
</template>
