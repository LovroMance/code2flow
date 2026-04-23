<script setup lang="ts">
import { Editor as MonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor } from 'monaco-editor'
import { shallowRef } from 'vue'
import type { NodeMapping } from '../../../entities/flow/model/types'
import type { CodeEditorExpose } from '../model/types'

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const monacoEditorRef = shallowRef<editor.IStandaloneCodeEditor | null>(null)
let decorationIds: string[] = []

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
      <span class="editor-chip">JavaScript</span>
      <span class="editor-chip">50 - 500 行</span>
      <span class="editor-chip">结构化输出</span>
    </div>
    <div class="editor-instance">
      <MonacoEditor
        :value="modelValue"
        language="javascript"
        theme="vs-dark"
        path="file:///workspace/input.js"
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
      <span>Monaco 已接入，支持后续行号联动与高亮装饰。</span>
      <span>当前默认按 JavaScript 模式编辑，后续可按语言切换。</span>
    </div>
  </div>
</template>
