<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMermaidRenderer } from '../model/useMermaidRenderer'
import { useDiagramViewport } from '../model/useDiagramViewport'
import type { NodeMapping } from '../../../entities/flow/model/types'

const props = defineProps<{
  mermaid: string
  mappings: ReadonlyArray<Pick<NodeMapping, 'nodeId'>>
  isStreaming?: boolean
  closeOnSelect?: boolean
  focusNodeId?: string
}>()

const emit = defineEmits<{ 'select-node': [nodeId: string]; 'render-error': [message: string] }>()
const expanded = ref(false)

async function selectNode(nodeId: string) {
  // 专注查看时点击节点，回到双栏后再定位源码，避免编辑器被遮住。
  if (props.closeOnSelect !== false) expanded.value = false
  await nextTick()
  emit('select-node', nodeId)
}

const { diagramElement, renderedSvg, renderError, isRendering } = useMermaidRenderer(
  () => props.mermaid,
  () => props.mappings,
  selectNode,
  () => !!props.isStreaming
)
watch(renderError, (error) => {
  if (error) emit('render-error', error)
})
const {
  viewportElement,
  camera,
  isDragging,
  isOverviewDragging,
  overviewNodes,
  overviewEdges,
  overviewViewBox,
  visibleRegion,
  fitView,
  focusNode,
  readView,
  changeZoom,
  handleWheel,
  handleKeydown,
  handlePointerDown,
  handlePointerMove,
  stopDragging,
  handleOverviewPointerDown,
  handleOverviewPointerMove,
  stopOverviewDragging
} = useDiagramViewport(renderedSvg, () => !!props.isStreaming)

watch([renderedSvg, () => props.focusNodeId], ([svg, id]) => {
  if (!svg) return
  for (const node of svg.querySelectorAll<SVGGraphicsElement>('[data-flow-node-id]')) {
    const selected = !!id && node.dataset.flowNodeId === id
    node.classList.toggle('diagram-node-focused', selected)
    if (selected) focusNode(node)
  }
}, { flush: 'post' })

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') expanded.value = false
}
onMounted(() => document.addEventListener('keydown', handleEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', handleEscape))
</script>

<template>
  <div
    class="diagram-shell"
    :class="{ 'diagram-shell-expanded': expanded }"
  >
    <div class="diagram-stage">
      <div class="diagram-toolbar">
        <slot name="toolbar">
          <h2 class="diagram-title">流程图</h2>
        </slot>
        <span
          class="diagram-toolbar-status sr-only-input"
          role="status"
        >
          <span
            class="diagram-status-dot"
            :class="{ 'is-updating': isStreaming || isRendering }"
          />
          {{ isStreaming ? '正在整理流程' : `${overviewNodes.length} 个节点` }}
        </span>
        <div v-if="mermaid" class="diagram-toolbar-actions">
          <button
            type="button"
            class="diagram-tool-button diagram-fit-button"
            title="适应全图"
            aria-label="适应全图"
            @click="fitView"
          >
            <svg
              class="ui-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle
                cx="10"
                cy="10"
                r="6"
              />
              <path d="m14.25 14.25 6.75 6.75M7 10h6M10 7v6" />
            </svg>
          </button>
          <button
            type="button"
            class="diagram-tool-button"
            aria-label="缩小流程图"
            @click="changeZoom(camera.scale / 1.2)"
          >
            −
          </button>
          <button
            type="button"
            class="diagram-tool-button diagram-zoom-label"
            title="100% 阅读"
            @click="readView"
          >
            {{ Math.round(camera.scale * 100) }}%
          </button>
          <button
            type="button"
            class="diagram-tool-button"
            aria-label="放大流程图"
            @click="changeZoom(camera.scale * 1.2)"
          >
            +
          </button>
          <button
            type="button"
            class="diagram-tool-button diagram-tool-button-wide diagram-focus-button"
            :aria-pressed="expanded"
            :aria-label="expanded ? '退出专注视图' : '专注视图'"
            :title="expanded ? '退出专注 · Esc' : '专注视图'"
            @click="expanded = !expanded"
          >
            <svg
              class="ui-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
            </svg>
          </button>
        </div>
      </div>
      <div v-show="mermaid" class="diagram-canvas">
        <div class="diagram-stage-grid" />
        <div
          ref="viewportElement"
          class="diagram-viewport"
          :class="{ 'diagram-viewport-dragging': isDragging }"
          aria-label="流程图画布，滚轮缩放，拖动空白区域平移"
          tabindex="0"
          @keydown="handleKeydown"
          @wheel="handleWheel"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="stopDragging"
          @pointercancel="stopDragging"
          @lostpointercapture="stopDragging"
        >
          <div
            class="diagram-render"
            :style="{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }"
          >
            <div
              ref="diagramElement"
              class="diagram-render-content"
            />
          </div>
        </div>
        <details
          v-if="overviewNodes.length"
          class="diagram-overview"
          :class="{ 'diagram-overview-dragging': isOverviewDragging }"
        >
          <summary>全局导航</summary>
          <div class="diagram-overview-heading">
            <span>全局导航</span><span>拖动 / 点击</span>
          </div>
          <svg
            :viewBox="overviewViewBox"
            role="img"
            aria-label="流程图全局导航，可拖动视口框或点击任意位置移动主视图"
            tabindex="0"
            @keydown="handleKeydown"
            @pointerdown="handleOverviewPointerDown"
            @pointermove="handleOverviewPointerMove"
            @pointerup="stopOverviewDragging"
            @pointercancel="stopOverviewDragging"
            @lostpointercapture="stopOverviewDragging"
          >
            <path
              v-for="(edge, index) in overviewEdges"
              :key="`edge-${index}`"
              :d="edge.path"
              :transform="edge.transform"
              class="diagram-overview-edge"
            />
            <rect
              v-for="(node, index) in overviewNodes"
              :key="index"
              v-bind="node"
              class="diagram-overview-node"
              rx="3"
            />
            <rect
              v-bind="visibleRegion"
              class="diagram-overview-region"
            />
          </svg>
        </details>
        <div
          v-if="renderError"
          class="diagram-error"
          role="alert"
        >
          {{ renderError }}
        </div>
      </div>
      <div v-if="!mermaid" class="diagram-empty"><slot name="empty" /></div>
      <slot v-if="mermaid" name="footer">
        <div class="diagram-footer">
          <span>滚轮以指针为中心缩放 · 拖动空白处平移</span><span>点击节点定位源码</span>
        </div>
      </slot>
    </div>
  </div>
</template>
