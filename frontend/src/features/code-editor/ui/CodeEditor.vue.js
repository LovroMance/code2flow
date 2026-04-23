import { Editor as MonacoEditor } from '@guolao/vue-monaco-editor'
import { shallowRef } from 'vue'
const __VLS_props = defineProps()
const emit = defineEmits()
const monacoEditorRef = shallowRef(null)
let decorationIds = []
const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbersMinChars: 3,
  padding: {
    top: 16,
    bottom: 16
  },
  scrollBeyondLastLine: false
}
function handleMount(instance) {
  monacoEditorRef.value = instance
  const input = instance.getDomNode()?.querySelector('textarea.inputarea')
  if (input instanceof HTMLTextAreaElement) {
    input.id = 'code2flow-editor-input'
    input.name = 'code2flow-editor-input'
  }
}
function updateValue(value) {
  emit('update:modelValue', value ?? '')
}
function focusMapping(mapping) {
  const editorInstance = monacoEditorRef.value
  if (!editorInstance) {
    return
  }
  const startColumn = mapping.columnStart ?? 1
  const endColumn = mapping.columnEnd ?? 1
  editorInstance.focus()
  editorInstance.revealLinesInCenter(mapping.lineStart, mapping.lineEnd)
  editorInstance.setSelection({
    startLineNumber: mapping.lineStart,
    startColumn,
    endLineNumber: mapping.lineEnd,
    endColumn
  })
  decorationIds = editorInstance.deltaDecorations(decorationIds, [
    {
      range: {
        startLineNumber: mapping.lineStart,
        startColumn,
        endLineNumber: mapping.lineEnd,
        endColumn
      },
      options: {
        isWholeLine: true,
        className: 'code2flow-line-highlight',
        linesDecorationsClassName: 'code2flow-gutter-highlight'
      }
    }
  ])
}
let __VLS_exposed
defineExpose({
  focusMapping
})
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
  ...{ class: 'editor-shell' }
})
/** @type {__VLS_StyleScopedClasses['editor-shell']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'editor-toolbar' }
})
/** @type {__VLS_StyleScopedClasses['editor-toolbar']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'editor-chip' }
})
/** @type {__VLS_StyleScopedClasses['editor-chip']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'editor-chip' }
})
/** @type {__VLS_StyleScopedClasses['editor-chip']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({
  ...{ class: 'editor-chip' }
})
/** @type {__VLS_StyleScopedClasses['editor-chip']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'editor-instance' }
})
/** @type {__VLS_StyleScopedClasses['editor-instance']} */ let __VLS_0
/** @ts-ignore @type {typeof __VLS_components.MonacoEditor | typeof __VLS_components.MonacoEditor} */
MonacoEditor
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(
  __VLS_0,
  new __VLS_0({
    ...{ onMount: {} },
    ...{ 'onUpdate:value': {} },
    value: __VLS_ctx.modelValue,
    language: 'javascript',
    theme: 'vs-dark',
    path: 'file:///workspace/input.js',
    height: '100%',
    className: 'code2flow-monaco',
    options: __VLS_ctx.editorOptions
  })
)
const __VLS_2 = __VLS_1(
  {
    ...{ onMount: {} },
    ...{ 'onUpdate:value': {} },
    value: __VLS_ctx.modelValue,
    language: 'javascript',
    theme: 'vs-dark',
    path: 'file:///workspace/input.js',
    height: '100%',
    className: 'code2flow-monaco',
    options: __VLS_ctx.editorOptions
  },
  ...__VLS_functionalComponentArgsRest(__VLS_1)
)
let __VLS_5
const __VLS_6 = ({ mount: {} }, { onMount: __VLS_ctx.handleMount })
const __VLS_7 = ({ 'update:value': {} }, { 'onUpdate:value': __VLS_ctx.updateValue })
const { default: __VLS_8 } = __VLS_3.slots
{
  const { default: __VLS_9 } = __VLS_3.slots
  __VLS_asFunctionalElement1(
    __VLS_intrinsics.div,
    __VLS_intrinsics.div
  )({
    ...{ class: 'editor-loading' }
  })
  /** @type {__VLS_StyleScopedClasses['editor-loading']} */ // @ts-ignore
  ;[modelValue, editorOptions, handleMount, updateValue]
}
// @ts-ignore
;[]
var __VLS_3
var __VLS_4
__VLS_asFunctionalElement1(
  __VLS_intrinsics.div,
  __VLS_intrinsics.div
)({
  ...{ class: 'editor-footer' }
})
/** @type {__VLS_StyleScopedClasses['editor-footer']} */ __VLS_asFunctionalElement1(
  __VLS_intrinsics.span,
  __VLS_intrinsics.span
)({})
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({})
// @ts-ignore
;[]
const __VLS_export = (await import('vue')).defineComponent({
  setup: () => __VLS_exposed,
  __typeEmits: {},
  __typeProps: {}
})
export default {}
