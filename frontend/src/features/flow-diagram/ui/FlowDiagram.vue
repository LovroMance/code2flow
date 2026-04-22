<script setup lang="ts">
import type { NodeMapping } from '../../../entities/flow/model/types'

defineProps<{
  mermaid: string
  mappings: NodeMapping[]
}>()
</script>

<template>
  <div class="diagram-shell">
    <div class="diagram-preview">
      <div class="diagram-stage">
        <div class="diagram-stage-grid" />
        <pre class="diagram-code">{{ mermaid }}</pre>
      </div>
    </div>

    <div class="mapping-list">
      <div class="mapping-header">
        <h3>节点映射</h3>
        <span>{{ mappings.length }} 个节点</span>
      </div>
      <ul v-if="mappings.length > 0">
        <li v-for="item in mappings" :key="item.nodeId">
          <strong>{{ item.nodeId }}</strong>
          <span>{{ item.description }}</span>
          <em>第 {{ item.lineStart }} - {{ item.lineEnd }} 行</em>
        </li>
      </ul>
      <div v-else class="mapping-empty">生成流程图后，这里会展示节点和代码行的映射关系。</div>
    </div>
  </div>
</template>
