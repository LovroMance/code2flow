<script setup lang="ts">
import { Editor as MonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { computed, shallowRef } from 'vue'
import type { NodeMapping, SupportedLanguage } from '../../../entities/flow/model/types'
import type { CodeEditorExpose } from '../model/types'
import { LANGUAGE_OPTIONS } from '../../../entities/flow/model/languages'
import { languages } from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  language: SupportedLanguage
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:language': [value: SupportedLanguage]
}>()

const monacoEditorRef = shallowRef<editor.IStandaloneCodeEditor | null>(null)
let decorationIds: string[] = []
const languageOptions = LANGUAGE_OPTIONS

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
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

const monacoLanguage = computed(() => mapToMonacoLanguage(props.language))
const editorPath = computed(() => `file:///workspace/input${mapToEditorExtension(props.language)}`)

function handleMount(instance: editor.IStandaloneCodeEditor) {
  monacoEditorRef.value = instance

  const input = instance.getDomNode()?.querySelector('textarea.inputarea')
  if (input instanceof HTMLTextAreaElement) {
    input.id = 'code2flow-editor-input'
    input.name = 'code2flow-editor-input'
  }
}

function updateValue(value: string | undefined) {
  emit('update:modelValue', value ?? '')
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

function mapToEditorExtension(language: SupportedLanguage) {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.extensions[0] ?? '.txt'
}

function focusMapping(mapping: NodeMapping) {
  const editorInstance = monacoEditorRef.value
  const model = editorInstance?.getModel()

  if (!editorInstance || !model) {
    return
  }

  const startColumn = mapping.columnStart ?? 1
  // 仅有行号时选到最后一行行尾；终点列为 1 会遗漏该行全部文本。
  const endColumn = mapping.columnEnd ?? model.getLineMaxColumn(mapping.lineEnd)

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

defineExpose<CodeEditorExpose>({
  focusMapping
})
</script>

<template>
  <div class="editor-shell">
    <div class="editor-toolbar">
      <label class="editor-language-control">
        <span class="editor-language-label">语言</span>
        <select class="editor-language-select" :value="language" @change="updateLanguage">
          <option v-for="option in languageOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <span class="editor-chip">生成流程图时会自动识别语言</span>
      <span class="editor-chip">目标规模 50–500 行</span>
      <span class="editor-chip">结构化输出</span>
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
