<script setup lang="ts">
import WorkspacePage from '../pages/workspace/WorkspacePage.vue'
</script>

<template>
  <div class="application-shell">
    <main class="application-content">
      <WorkspacePage />
    </main>
  </div>
</template>

<style scoped>
.application-shell {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 1100px;
  height: 100vh;
  height: 100dvh;
}
.application-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
</style>
