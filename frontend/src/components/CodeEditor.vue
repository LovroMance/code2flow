<script setup lang="ts">
const sampleCode = `async function loadUser() {
  const user = await fetchUser()

  if (user.isActive) {
    goToDashboard()
  } else {
    showInactiveMessage()
  }
}`
</script>

<template>
  <div class="editor-shell">
    <textarea
      class="editor-textarea"
      :value="sampleCode"
      spellcheck="false"
      aria-label="code editor placeholder"
    />
  </div>
</template>
