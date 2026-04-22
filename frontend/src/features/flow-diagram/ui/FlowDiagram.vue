<script setup lang="ts">
import { computed } from 'vue'
import type { NodeMapping } from '../../../entities/flow/model/types'
import { useMermaidRenderer } from '../model/useMermaidRenderer'

const props = defineProps<{
  mermaid: string
  mappings: NodeMapping[]
  selectedNodeId?: string
}>()

const emit = defineEmits<{
  'select-node': [nodeId: string]
}>()

const { diagramElement, renderError } = useMermaidRenderer(
  () => props.mermaid,
  () => props.mappings,
  (nodeId) => emit('select-node', nodeId)
)

const hasMappings = computed(() => props.mappings.length > 0)
</script>

<template>
  <div class="diagram-shell">
    <div class="diagram-preview">
      <div class="diagram-stage">
        <div class="diagram-stage-grid" />
        <div ref="diagramElement" class="diagram-render" />
        <div v-if="renderError" class="diagram-error">
          {{ renderError }}
        </div>
      </div>
    </div>

    <div class="mapping-list">
      <div class="mapping-header">
        <h3>节点映射</h3>
        <span>{{ mappings.length }} 个节点</span>
      </div>
      <ul v-if="hasMappings">
        <li
          v-for="item in mappings"
          :key="item.nodeId"
          :class="{ 'mapping-item-active': item.nodeId === selectedNodeId }"
          @click="emit('select-node', item.nodeId)"
        >
          <strong>{{ item.label }}</strong>
          <span>{{ item.kind }} · {{ item.nodeId }}</span>
          <span>{{ item.description }}</span>
          <em>第 {{ item.lineStart }} - {{ item.lineEnd }} 行</em>
        </li>
      </ul>
      <div v-else class="mapping-empty">生成流程图后，这里会展示节点和代码行的映射关系。</div>
    </div>
  </div>
</template>
