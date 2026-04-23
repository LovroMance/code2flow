import { ref } from 'vue'
import { useMermaidRenderer } from '../model/useMermaidRenderer'
const props = defineProps()
const emit = defineEmits()
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
function handleWheel(event) {
  event.preventDefault()
  if (event.deltaY < 0) {
    zoomIn()
    return
  }
  zoomOut()
}
const __VLS_ctx = {
  ...{},
  ...{},
  ...{},
  ...{},
  ...{}
}
let __VLS_components
let __VLS_intrinsics
let __VLS_directives
__VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-shell' }
})
/** @type {__VLS_StyleScopedClasses['diagram-shell']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-preview' }
})
/** @type {__VLS_StyleScopedClasses['diagram-preview']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-stage' }
})
/** @type {__VLS_StyleScopedClasses['diagram-stage']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-toolbar' }
})
/** @type {__VLS_StyleScopedClasses['diagram-toolbar']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.zoomOut },
  type: 'button',
  ...{ class: 'diagram-tool-button' }
})
/** @type {__VLS_StyleScopedClasses['diagram-tool-button']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'diagram-zoom-label' }
})
/** @type {__VLS_StyleScopedClasses['diagram-zoom-label']} */ Math.round(__VLS_ctx.scale * 100)
__VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.zoomIn },
  type: 'button',
  ...{ class: 'diagram-tool-button' }
})
/** @type {__VLS_StyleScopedClasses['diagram-tool-button']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.resetView },
  type: 'button',
  ...{ class: 'diagram-tool-button diagram-tool-button-wide' }
})
/** @type {__VLS_StyleScopedClasses['diagram-tool-button']} */ /** @type {__VLS_StyleScopedClasses['diagram-tool-button-wide']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-stage-grid' }
})
/** @type {__VLS_StyleScopedClasses['diagram-stage-grid']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ onWheel: __VLS_ctx.handleWheel },
  ...{ class: 'diagram-viewport' }
})
/** @type {__VLS_StyleScopedClasses['diagram-viewport']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'diagram-render' },
  ...{ style: { transform: `scale(${__VLS_ctx.scale})` } }
})
/** @type {__VLS_StyleScopedClasses['diagram-render']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ref: 'diagramElement',
  ...{ class: 'diagram-render-content' }
})
/** @type {__VLS_StyleScopedClasses['diagram-render-content']} */ if (__VLS_ctx.renderError) {
  __VLS_asFunctionalElement1(
    __VLS_intrinsics.div,
    __VLS_intrinsics.div
  )({
    ...{ class: 'diagram-error' }
  })
  /** @type {__VLS_StyleScopedClasses['diagram-error']} */ __VLS_ctx.renderError
}
// @ts-ignore
;[zoomOut, scale, scale, zoomIn, resetView, handleWheel, renderError, renderError]
const __VLS_export = (await import('vue')).defineComponent({
  __typeEmits: {},
  __typeProps: {}
})
export default {}
