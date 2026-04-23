<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
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
const viewportElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const offsetX = ref(0)
const offsetY = ref(0)
let dragStartX = 0
let dragStartY = 0
let startOffsetX = 0
let startOffsetY = 0

function zoomIn() {
  scale.value = Math.min(2.5, Number((scale.value + 0.1).toFixed(2)))
}

function zoomOut() {
  scale.value = Math.max(0.45, Number((scale.value - 0.1).toFixed(2)))
}

function resetView() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()

  if (event.deltaY < 0) {
    zoomIn()
    return
  }

  zoomOut()
}

function handlePointerDown(event: PointerEvent) {
  if (!viewportElement.value || event.button !== 0) {
    return
  }

  const target = event.target instanceof Element ? event.target : null

  if (target?.closest('button')) {
    return
  }

  // 点击 Mermaid 节点时保留原生节点点击行为，不进入画布拖动。
  if (target?.closest('.node, g.node, .label, .edgeLabel, .cluster')) {
    return
  }

  isDragging.value = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  startOffsetX = offsetX.value
  startOffsetY = offsetY.value

  viewportElement.value.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (!viewportElement.value || !isDragging.value) {
    return
  }

  const deltaX = event.clientX - dragStartX
  const deltaY = event.clientY - dragStartY

  offsetX.value = startOffsetX + deltaX
  offsetY.value = startOffsetY + deltaY
}

function stopDragging(event?: PointerEvent) {
  if (!isDragging.value) {
    return
  }

  isDragging.value = false

  if (viewportElement.value && event) {
    viewportElement.value.releasePointerCapture(event.pointerId)
  }
}

onBeforeUnmount(() => {
  isDragging.value = false
})
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
        <div
          ref="viewportElement"
          class="diagram-viewport"
          :class="{ 'diagram-viewport-dragging': isDragging }"
          @wheel="handleWheel"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="stopDragging"
          @pointercancel="stopDragging"
          @pointerleave="stopDragging"
        >
          <div
            class="diagram-render"
            :style="{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }"
          >
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
