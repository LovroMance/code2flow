<script setup lang="ts">
import { ref } from 'vue'
import type { CodeEditorExpose } from '../../features/code-editor/model/types'
import CodeEditor from '../../features/code-editor/ui/CodeEditor.vue'
import FlowDiagram from '../../features/flow-diagram/ui/FlowDiagram.vue'
import { useWorkspacePage } from '../../features/workspace/model/useWorkspacePage'

const editorRef = ref<CodeEditorExpose | null>(null)

const {
  code,
  errorMessage,
  handleGenerate,
  healthStatus,
  isLoading,
  loadSample,
  mappings,
  mermaid,
  status,
  statusText,
  clearWorkspace,
  findMappingByNodeId,
  selectedNodeId,
  selectNode
} = useWorkspacePage()

function handleSelectNode(nodeId: string) {
  selectNode(nodeId)

  const mapping = findMappingByNodeId(nodeId)
  if (!mapping) {
    return
  }

  editorRef.value?.focusMapping(mapping)
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <p class="eyebrow">Code2Flow Workspace</p>
        <h1>前端代码流程分析台</h1>
        <p class="hero-copy">
          先把输入、建图、映射和状态链路放进一个清晰的工作台，后续再逐步接入 Monaco、Mermaid 和真实
          Agent。
        </p>
      </div>

      <div class="topbar-actions">
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

    <section class="status-strip">
      <article class="status-card">
        <span class="status-label">当前阶段</span>
        <strong>Stage 1 MVP</strong>
        <p>先做代码输入、流程图输出、节点映射和流式状态。</p>
      </article>
      <article class="status-card">
        <span class="status-label">Agent 状态</span>
        <strong>{{ statusText }}</strong>
        <p>当前已经接上前端按钮与后端 mock SSE。</p>
      </article>
      <article class="status-card">
        <span class="status-label">后端健康</span>
        <strong>{{ healthStatus }}</strong>
        <p>普通接口通过 axios 访问，流式接口继续使用 fetch。</p>
      </article>
    </section>

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
          <span class="badge badge-active">Monaco Ready</span>
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
          <FlowDiagram
            :mermaid="mermaid"
            :mappings="mappings"
            :selected-node-id="selectedNodeId"
            @select-node="handleSelectNode"
          />
        </section>
      </section>
    </main>
  </div>
</template>
