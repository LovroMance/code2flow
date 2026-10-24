<script setup lang="ts">
import WorkspacePage from '../pages/workspace/WorkspacePage.vue'
</script>

<template>
  <div class="application-shell">
    <nav class="application-nav" aria-label="主导航">
      <span class="application-brand">Code2Flow</span>
      <span class="application-current">工作区</span>
    </nav>
    <main class="application-content">
      <WorkspacePage />
    </main>
  </div>
</template>

<style scoped>
.application-shell {
  /* 固定顶栏与工作区行高，侧栏折叠不能改变主区域的可用高度。 */
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  min-width: 1100px;
  height: 100vh;
  height: 100dvh;
  min-height: 100dvh;
}
.application-nav {
  display: flex;
  flex: 0 0 48px;
  align-items: center;
  gap: 6px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
}
.application-brand {
  margin-right: 20px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-soft);
}
.application-current {
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
}
.application-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
</style>
