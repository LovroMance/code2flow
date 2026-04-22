<script setup lang="ts">
defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="editor-shell">
    <div class="editor-toolbar">
      <span class="editor-chip">JavaScript</span>
      <span class="editor-chip">50 - 500 行</span>
      <span class="editor-chip">结构化输出</span>
    </div>
    <textarea
      class="editor-textarea"
      :value="modelValue"
      spellcheck="false"
      aria-label="code editor placeholder"
      @input="handleInput"
    />
    <div class="editor-footer">
      <span>输入区先用 textarea 占位，后续替换为 Monaco Editor。</span>
      <span>支持代码粘贴、示例导入和行号映射联动。</span>
    </div>
  </div>
</template>
