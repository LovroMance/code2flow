<script setup lang="ts">
import CodeEditor from './components/CodeEditor.vue'
import FlowDiagram from './components/FlowDiagram.vue'
import { useAgentStream } from './composables/useAgentStream'

const { status, mermaid, mappings } = useAgentStream()
</script>

<template>
  <div class="app-shell">
    <header class="hero">
      <p class="eyebrow">Code2Flow</p>
      <h1>把前端代码拆成一张能读懂的流程图</h1>
      <p class="hero-copy">
        阶段一骨架已经就位：编辑区、流程图区、节点映射区和最小流式状态入口都已预留。
      </p>
    </header>

    <main class="workspace">
      <section class="panel">
        <div class="panel-header">
          <h2>代码输入</h2>
          <span class="badge">Monaco 待接入</span>
        </div>
        <CodeEditor />
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>流程图预览</h2>
          <span class="badge">{{ status }}</span>
        </div>
        <FlowDiagram :mermaid="mermaid" :mappings="mappings" />
      </section>
    </main>
  </div>
</template>
