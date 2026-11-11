<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import EvaluationPage from '../pages/evaluation/EvaluationPage.vue'
import WorkspacePage from '../pages/workspace/WorkspacePage.vue'

const evaluationOpen = ref(location.pathname === '/evaluations')
const syncPage = () => { evaluationOpen.value = location.pathname === '/evaluations' }

function navigate(path: string) {
  history.pushState(null, '', path)
  syncPage()
}

onMounted(() => window.addEventListener('popstate', syncPage))
onUnmounted(() => window.removeEventListener('popstate', syncPage))
</script>

<template>
  <div class="application-shell" :class="{ 'is-evaluation': evaluationOpen }">
    <main class="application-content">
      <KeepAlive include="WorkspacePage">
        <WorkspacePage v-if="!evaluationOpen" @open-evaluation="navigate('/evaluations')" />
        <EvaluationPage v-else @back="navigate('/')" />
      </KeepAlive>
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
.application-shell.is-evaluation {
  min-width: 0;
}
.application-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
</style>
