<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMermaidRenderer } from '../model/useMermaidRenderer'
import { useDiagramViewport } from '../model/useDiagramViewport'
import type { NodeMapping } from '../../../entities/flow/model/types'

const props = defineProps<{
  mermaid: string
  mappings: NodeMapping[]
  isStreaming?: boolean
}>()

const emit = defineEmits<{ 'select-node': [nodeId: string]; 'render-error': [message: string] }>()
const expanded = ref(false)

async function selectNode(nodeId: string) {
  // 专注查看时点击节点，回到双栏后再定位源码，避免编辑器被遮住。
  expanded.value = false
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
  if (error) emit('render-error', '流程图渲染失败，请重新生成。')
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

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') expanded.value = false
}
onMounted(() => document.addEventListener('keydown', handleEscape))
onBeforeUnmount(() => document.removeEventListener('keydown', handleEscape))
</script>

<template>
  <div class="diagram-shell" :class="{ 'diagram-shell-expanded': expanded }">
    <div class="diagram-stage">
      <div class="diagram-toolbar">
        <span class="diagram-toolbar-status" role="status">
          <span class="diagram-status-dot" :class="{ 'is-updating': isStreaming || isRendering }" />
          {{ isStreaming ? '正在整理流程' : `${overviewNodes.length} 个节点` }}
        </span>
        <div class="diagram-toolbar-actions">
          <button
            type="button"
            class="diagram-tool-button"
            aria-label="缩小流程图"
            @click="changeZoom(camera.scale / 1.2)"
          >
            −
          </button>
          <span class="diagram-zoom-label">{{ Math.round(camera.scale * 100) }}%</span>
          <button
            type="button"
            class="diagram-tool-button"
            aria-label="放大流程图"
            @click="changeZoom(camera.scale * 1.2)"
          >
            +
          </button>
          <span class="diagram-toolbar-divider" />
          <button
            type="button"
            class="diagram-tool-button diagram-tool-button-wide"
            title="查看完整流程结构"
            @click="fitView"
          >
            适应全图
          </button>
          <button
            type="button"
            class="diagram-tool-button diagram-tool-button-wide"
            title="以原始字号阅读，配合小地图导航"
            @click="readView"
          >
            100% 阅读
          </button>
          <button
            type="button"
            class="diagram-tool-button diagram-tool-button-wide diagram-focus-button"
            :aria-pressed="expanded"
            @click="expanded = !expanded"
          >
            {{ expanded ? '退出专注 · Esc' : '专注视图' }}
          </button>
        </div>
      </div>
      <div class="diagram-canvas">
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
            <div ref="diagramElement" class="diagram-render-content" />
          </div>
        </div>
        <div
          v-if="overviewNodes.length"
          class="diagram-overview"
          :class="{ 'diagram-overview-dragging': isOverviewDragging }"
        >
          <div class="diagram-overview-heading"><span>全局导航</span><span>拖动 / 点击</span></div>
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
            <rect v-bind="visibleRegion" class="diagram-overview-region" />
          </svg>
        </div>
        <div v-if="renderError" class="diagram-error" role="alert">
          {{ renderError }}
        </div>
      </div>
      <div class="diagram-footer">
        <span>滚轮以指针为中心缩放 · 拖动空白处平移</span><span>点击节点定位源码</span>
      </div>
    </div>
  </div>
</template>
