<script setup lang="ts">
interface NodeMapping {
  nodeId: string
  lineStart: number
  lineEnd: number
  description: string
}

defineProps<{
  mermaid: string
  mappings: NodeMapping[]
}>()
</script>

<template>
  <div class="diagram-shell">
    <pre class="diagram-code">{{ mermaid }}</pre>

    <div class="mapping-list">
      <h3>节点映射</h3>
      <ul>
        <li v-for="item in mappings" :key="item.nodeId">
          <strong>{{ item.nodeId }}</strong>
          <span>{{ item.description }}</span>
          <em>第 {{ item.lineStart }} - {{ item.lineEnd }} 行</em>
        </li>
      </ul>
    </div>
  </div>
</template>
