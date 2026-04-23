<script setup lang="ts">
import { ref } from 'vue'
import { useMermaidRenderer } from '../model/useMermaidRenderer'

const props = defineProps<{
  mermaid: string
  mappings: Array<{ nodeId: string }>
}>()

const emit = defineEmits<{
  'select-node': [nodeId: string]
}>()

const { diagramElement, renderError } = useMermaidRenderer(
  () => props.mermaid,
  () => props.mappings,
  (nodeId) => emit('select-node', nodeId)
)

const scale = ref(1)

function zoomIn() {
  scale.value = Math.min(2.5, Number((scale.value + 0.1).toFixed(2)))
}

function zoomOut() {
  scale.value = Math.max(0.45, Number((scale.value - 0.1).toFixed(2)))
}

function resetView() {
  scale.value = 1
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()

  if (event.deltaY < 0) {
    zoomIn()
    return
  }

  zoomOut()
}
</script>

<template>
  <div class="diagram-shell">
    <div class="diagram-preview">
      <div class="diagram-stage">
        <div class="diagram-toolbar">
          <button type="button" class="diagram-tool-button" @click="zoomOut">-</button>
          <span class="diagram-zoom-label">{{ Math.round(scale * 100) }}%</span>
          <button type="button" class="diagram-tool-button" @click="zoomIn">+</button>
          <button
            type="button"
            class="diagram-tool-button diagram-tool-button-wide"
            @click="resetView"
          >
            重置视图
          </button>
        </div>
        <div class="diagram-stage-grid" />
        <div class="diagram-viewport" @wheel="handleWheel">
          <div class="diagram-render" :style="{ transform: `scale(${scale})` }">
            <div ref="diagramElement" class="diagram-render-content"></div>
          </div>
        </div>
        <div v-if="renderError" class="diagram-error">
          {{ renderError }}
        </div>
      </div>
    </div>
  </div>
</template>
