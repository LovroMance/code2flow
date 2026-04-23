import { ref } from 'vue'
import CodeEditor from '../../features/code-editor/ui/CodeEditor.vue'
import FlowDiagram from '../../features/flow-diagram/ui/FlowDiagram.vue'
import { useWorkspacePage } from '../../features/workspace/model/useWorkspacePage'
const editorRef = ref(null)
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
  findMappingByNodeId
} = useWorkspacePage()
function handleSelectNode(nodeId) {
  const mapping = findMappingByNodeId(nodeId)
  if (!mapping) {
    return
  }
  editorRef.value?.focusMapping(mapping)
}
const __VLS_ctx = {
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
  ...{ class: 'app-shell' }
})
/** @type {__VLS_StyleScopedClasses['app-shell']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.header,
  __VLS_intrinsics.header
)({
  ...{ class: 'topbar' }
})
/** @type {__VLS_StyleScopedClasses['topbar']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'brand-block' }
})
/** @type {__VLS_StyleScopedClasses['brand-block']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.p,
  __VLS_intrinsics.p
)({
  ...{ class: 'eyebrow' }
})
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.h1,
  __VLS_intrinsics.h1
)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.p,
  __VLS_intrinsics.p
)({
  ...{ class: 'hero-copy' }
})
/** @type {__VLS_StyleScopedClasses['hero-copy']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'topbar-actions' }
})
/** @type {__VLS_StyleScopedClasses['topbar-actions']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.loadSample },
  ...{ class: 'ghost-button' },
  type: 'button'
})
/** @type {__VLS_StyleScopedClasses['ghost-button']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.clearWorkspace },
  ...{ class: 'ghost-button' },
  type: 'button'
})
/** @type {__VLS_StyleScopedClasses['ghost-button']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.button,
  __VLS_intrinsics.button
)({
  ...{ onClick: __VLS_ctx.handleGenerate },
  ...{ class: 'primary-button' },
  type: 'button',
  disabled: __VLS_ctx.isLoading || !__VLS_ctx.code.trim()
})
/** @type {__VLS_StyleScopedClasses['primary-button']} */ __VLS_ctx.isLoading
  ? '生成中...'
  : '生成流程图'
__VLS_asFunctionalElement1(
  __VLS_intrinsics.section,
  __VLS_intrinsics.section
)({
  ...{ class: 'status-strip' }
})
/** @type {__VLS_StyleScopedClasses['status-strip']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.article,
  __VLS_intrinsics.article
)({
  ...{ class: 'status-card' }
})
/** @type {__VLS_StyleScopedClasses['status-card']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'status-label' }
})
/** @type {__VLS_StyleScopedClasses['status-label']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.strong,
  __VLS_intrinsics.strong
)({})
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.article,
  __VLS_intrinsics.article
)({
  ...{ class: 'status-card' }
})
/** @type {__VLS_StyleScopedClasses['status-card']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'status-label' }
})
/** @type {__VLS_StyleScopedClasses['status-label']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.strong,
  __VLS_intrinsics.strong
)({})
__VLS_ctx.statusText
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.article,
  __VLS_intrinsics.article
)({
  ...{ class: 'status-card' }
})
/** @type {__VLS_StyleScopedClasses['status-card']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'status-label' }
})
/** @type {__VLS_StyleScopedClasses['status-label']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.strong,
  __VLS_intrinsics.strong
)({})
__VLS_ctx.healthStatus
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({})
if (__VLS_ctx.errorMessage) {
  __VLS_asFunctionalElement1(
    __VLS_intrinsics.p,
    __VLS_intrinsics.p
  )({
    ...{ class: 'error-banner' }
  })
  /** @type {__VLS_StyleScopedClasses['error-banner']} */ __VLS_ctx.errorMessage
}
__VLS_asFunctionalElement1(
  __VLS_intrinsics.main,
  __VLS_intrinsics.main
)({
  ...{ class: 'workspace-shell' }
})
/** @type {__VLS_StyleScopedClasses['workspace-shell']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.section,
  __VLS_intrinsics.section
)({
  ...{ class: 'editor-panel panel' }
})
/** @type {__VLS_StyleScopedClasses['editor-panel']} */ /** @type {__VLS_StyleScopedClasses['panel']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'panel-header' }
})
/** @type {__VLS_StyleScopedClasses['panel-header']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.p,
  __VLS_intrinsics.p
)({
  ...{ class: 'panel-kicker' }
})
/** @type {__VLS_StyleScopedClasses['panel-kicker']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.h2,
  __VLS_intrinsics.h2
)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'badge badge-active' }
})
/** @type {__VLS_StyleScopedClasses['badge']} */ /** @type {__VLS_StyleScopedClasses['badge-active']} */ const __VLS_0 =
  CodeEditor
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(
  __VLS_0,
  new __VLS_0({
    ref: 'editorRef',
    modelValue: __VLS_ctx.code
  })
)
const __VLS_2 = __VLS_1(
  {
    ref: 'editorRef',
    modelValue: __VLS_ctx.code
  },
  ...__VLS_functionalComponentArgsRest(__VLS_1)
)
var __VLS_5 = {}
var __VLS_3
__VLS_asFunctionalElement1(
  __VLS_intrinsics.section,
  __VLS_intrinsics.section
)({
  ...{ class: 'analysis-panel' }
})
/** @type {__VLS_StyleScopedClasses['analysis-panel']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.section,
  __VLS_intrinsics.section
)({
  ...{ class: 'panel diagram-panel' }
})
/** @type {__VLS_StyleScopedClasses['panel']} */ /** @type {__VLS_StyleScopedClasses['diagram-panel']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'panel-header' }
})
/** @type {__VLS_StyleScopedClasses['panel-header']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.p,
  __VLS_intrinsics.p
)({
  ...{ class: 'panel-kicker' }
})
/** @type {__VLS_StyleScopedClasses['panel-kicker']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.h2,
  __VLS_intrinsics.h2
)({})
__VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'badge' },
  ...{ class: { 'badge-active': __VLS_ctx.status !== 'idle' } }
})
/** @type {__VLS_StyleScopedClasses['badge']} */ /** @type {__VLS_StyleScopedClasses['badge-active']} */ __VLS_ctx.statusText
const __VLS_7 = FlowDiagram
// @ts-ignore
const __VLS_8 = __VLS_asFunctionalComponent1(
  __VLS_7,
  new __VLS_7({
    ...{ onSelectNode: {} },
    mermaid: __VLS_ctx.mermaid,
    mappings: __VLS_ctx.mappings
  })
)
const __VLS_9 = __VLS_8(
  {
    ...{ onSelectNode: {} },
    mermaid: __VLS_ctx.mermaid,
    mappings: __VLS_ctx.mappings
  },
  ...__VLS_functionalComponentArgsRest(__VLS_8)
)
let __VLS_12
const __VLS_13 = ({ selectNode: {} }, { onSelectNode: __VLS_ctx.handleSelectNode })
var __VLS_10
var __VLS_11
// @ts-ignore
var __VLS_6 = __VLS_5
// @ts-ignore
;[
  loadSample,
  clearWorkspace,
  handleGenerate,
  isLoading,
  isLoading,
  code,
  code,
  statusText,
  statusText,
  healthStatus,
  errorMessage,
  errorMessage,
  status,
  mermaid,
  mappings,
  handleSelectNode
]
const __VLS_export = (await import('vue')).defineComponent({})
export default {}
