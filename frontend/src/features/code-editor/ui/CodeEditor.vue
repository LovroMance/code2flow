<script setup lang="ts">
import { Editor as MonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { computed, shallowRef } from 'vue'
import type { NodeMapping, SupportedLanguage } from '../../../entities/flow/model/types'
import type { CodeEditorExpose } from '../model/types'

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
const languageOptions: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'vue', label: 'Vue' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'csharp', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'unknown', label: 'Plain Text' }
]

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
  switch (language) {
    case 'vue':
      return 'html'
    case 'unknown':
      return 'plaintext'
    default:
      return language
  }
}

function mapToEditorExtension(language: SupportedLanguage) {
  switch (language) {
    case 'typescript':
      return '.ts'
    case 'vue':
      return '.vue'
    case 'java':
      return '.java'
    case 'c':
      return '.c'
    case 'cpp':
      return '.cpp'
    case 'python':
      return '.py'
    case 'go':
      return '.go'
    case 'rust':
      return '.rs'
    case 'csharp':
      return '.cs'
    case 'php':
      return '.php'
    case 'unknown':
      return '.txt'
    default:
      return '.js'
  }
}

function focusMapping(mapping: NodeMapping) {
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
      <span>自动识别语言，也可手动选择</span>
    </div>
  </div>
</template>
