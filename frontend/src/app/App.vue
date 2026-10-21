<script setup lang="ts">
import { ref } from 'vue'
import WorkspacePage from '../pages/workspace/WorkspacePage.vue'
import UsageConsolePage from '../pages/console/UsageConsolePage.vue'

const activePage = ref<'workspace' | 'console'>('workspace')
</script>

<template>
  <div class="application-shell">
    <nav
      class="application-nav"
      aria-label="主导航"
    >
      <span class="application-brand">Code2Flow</span>
      <button
        type="button"
        :aria-current="activePage === 'workspace' ? 'page' : undefined"
        @click="activePage = 'workspace'"
      >
        工作区
      </button>
      <button
        type="button"
        :aria-current="activePage === 'console' ? 'page' : undefined"
        @click="activePage = 'console'"
      >
        控制台
      </button>
    </nav>
    <main class="application-content">
      <!-- 保留实例，切换页面不会取消 SSE 或清空编辑器、图和问答。 -->
      <WorkspacePage v-show="activePage === 'workspace'" />
      <UsageConsolePage v-if="activePage === 'console'" />
    </main>
  </div>
</template>

<style scoped>
.application-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
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
.application-nav button {
  border: 0;
  border-radius: 6px;
  padding: 7px 14px;
  color: var(--text-soft);
  background: transparent;
  font-size: 12px;
}
.application-nav button[aria-current='page'] {
  color: var(--accent);
  background: var(--accent-soft);
}
.application-content {
  flex: 1;
  min-height: 0;
}
.application-content :deep(.app-shell) {
  height: 100%;
}
</style>
