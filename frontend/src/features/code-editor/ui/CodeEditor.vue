<script setup lang="ts">
import { Editor as MonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { computed, shallowRef, onBeforeUnmount, watch, nextTick } from 'vue'
import type { NodeMapping, SupportedLanguage } from '../../../entities/flow/model/types'
import type { CodeEditorExpose } from '../model/types'
import { mappingSelection } from '../model/mappingSelection'
import { LANGUAGE_OPTIONS } from '../../../entities/flow/model/languages'
import { languages, editor as monacoEditor, Uri } from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  language: SupportedLanguage
  disabled?: boolean
  documentId?: string
  documentIds?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:language': [value: SupportedLanguage]
}>()

const monacoEditorRef = shallowRef<editor.IStandaloneCodeEditor | null>(null)
const ownedPaths = new Set<string>()
let pendingMapping: NodeMapping | undefined
let decorationIds: string[] = []
const languageOptions = LANGUAGE_OPTIONS

const editorOptions = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
  readOnly: !!props.disabled,
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  lineNumbersMinChars: 3,
  padding: {
    top: 16,
    bottom: 16
  },
  scrollBeyondLastLine: false
}))

const monacoLanguage = computed(() => mapToMonacoLanguage(props.language))
// 文档身份跟随会话，语言只更新高亮；避免切换扩展名时复用到旧 Monaco model。
const editorPath = computed(
  () => `file:///workspace/${encodeURIComponent(props.documentId ?? 'input')}`
)

function handleMount(instance: editor.IStandaloneCodeEditor) {
  monacoEditorRef.value = instance
  ownedPaths.add(Uri.parse(editorPath.value).toString())
  if (pendingMapping) {
    const mapping = pendingMapping
    pendingMapping = undefined
    focusMapping(mapping)
  }

  const input = instance.getDomNode()?.querySelector('textarea.inputarea')
  if (input instanceof HTMLTextAreaElement) {
    input.id = 'code2flow-editor-input'
    input.name = 'code2flow-editor-input'
  }
}

function updateValue(value: string | undefined) {
  const text = value ?? ''
  emit(
    'update:modelValue',
    props.modelValue.startsWith('\uFEFF') && !text.startsWith('\uFEFF') ? `\uFEFF${text}` : text
  )
}

function updateLanguage(event: Event) {
  const target = event.target

  if (!(target instanceof HTMLSelectElement)) {
    return
  }

  emit('update:language', target.value as SupportedLanguage)
}

function mapToMonacoLanguage(language: SupportedLanguage) {
  const id = LANGUAGE_OPTIONS.find((option) => option.value === language)?.monaco ?? 'plaintext'
  return languages.getLanguages().some((entry) => entry.id === id) ? id : 'plaintext'
}

function focusMapping(mapping: NodeMapping) {
  const editorInstance = monacoEditorRef.value
  const model = editorInstance?.getModel()

  if (
    !editorInstance ||
    !model ||
    model.uri.toString() !== Uri.parse(editorPath.value).toString()
  ) {
    pendingMapping = mapping
    return
  }

  const selection = mappingSelection(mapping, props.modelValue, (line) =>
    model.getLineMaxColumn(line)
  )
  const startColumn = selection.startColumn
  const endColumn = selection.endColumn

  editorInstance.focus()
  editorInstance.revealLinesInCenter(mapping.lineStart, mapping.lineEnd)
  editorInstance.setSelection(selection)

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

watch(
  editorPath,
  async (path) => {
    ownedPaths.add(Uri.parse(path).toString())
    await nextTick()
    const model = monacoEditorRef.value?.getModel()
    if (model && model.getValue() !== props.modelValue) model.setValue(props.modelValue)
    // 包装组件切换model后再定位，不把新文件行号应用到旧model。
    if (pendingMapping) {
      const mapping = pendingMapping
      pendingMapping = undefined
      focusMapping(mapping)
    }
  },
  { flush: 'post' }
)
watch(
  () => props.documentIds,
  async (ids) => {
    if (!ids) return
    await nextTick()
    const valid = new Set(
      ids.map((id) => Uri.parse(`file:///workspace/${encodeURIComponent(id)}`).toString())
    )
    for (const model of monacoEditor.getModels())
      if (ownedPaths.has(model.uri.toString()) && !valid.has(model.uri.toString())) {
        ownedPaths.delete(model.uri.toString())
        model.dispose()
      }
  },
  { deep: true, flush: 'post' }
)
onBeforeUnmount(() => {
  for (const model of monacoEditor.getModels())
    if (ownedPaths.has(model.uri.toString())) model.dispose()
})

defineExpose<CodeEditorExpose>({
  focusMapping
})
</script>

<template>
  <div class="editor-shell">
    <div class="editor-toolbar">
      <label class="editor-language-control">
        <span class="editor-language-label">语言</span>
        <select
          class="editor-language-select"
          :value="language"
          :disabled="disabled"
          @change="updateLanguage"
        >
          <option v-for="option in languageOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <span class="editor-chip">生成流程图时会自动识别语言</span>
    </div>
    <div class="editor-instance">
      <MonacoEditor
        :value="modelValue"
        :language="monacoLanguage"
        theme="vs-dark"
        :path="editorPath"
        height="100%"
        class-name="code2flow-monaco"
        :options="editorOptions"
        @mount="handleMount"
        @update:value="updateValue"
      >
        <template #default>
          <div class="editor-loading">正在加载 Monaco Editor...</div>
        </template>
      </MonacoEditor>
    </div>
    <div class="editor-footer">
      <span>支持直接编辑、文件导入与节点行号定位</span>
      <span>可手动选择编辑器高亮语言</span>
    </div>
  </div>
</template>
