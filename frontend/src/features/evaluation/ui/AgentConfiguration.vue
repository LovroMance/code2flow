<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchEvaluationAgentConfig, type EvaluationAgentStage } from '../../../shared/api/evaluation.api'
import { getErrorMessage } from '../../../shared/lib/errorMessage'

const stages = ref<EvaluationAgentStage[]>([])
const selectedId = ref('index')
const selected = computed(() => stages.value.find((stage) => stage.id === selectedId.value))
const prompt = computed(() => selected.value?.systemPrompt ?? selected.value?.choice?.instructions ?? '')
const loading = ref(false)
const error = ref('')
const copyStatus = ref('')
let pending: AbortController | undefined

async function loadConfiguration() {
  pending?.abort()
  const request = new AbortController()
  pending = request
  loading.value = true
  error.value = ''
  copyStatus.value = ''
  try {
    const config = await fetchEvaluationAgentConfig(request.signal)
    if (request.signal.aborted) return
    stages.value = config.stages
    if (!stages.value.some((stage) => stage.id === selectedId.value)) selectedId.value = stages.value[0]?.id ?? ''
  } catch (cause) {
    if (!request.signal.aborted) error.value = getErrorMessage(cause, '读取当前 Agent 配置失败。')
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

async function copyPrompt() {
  const current = selectedId.value
  try {
    await navigator.clipboard.writeText(prompt.value)
    if (selectedId.value === current) copyStatus.value = '已复制'
  } catch {
    if (selectedId.value === current) copyStatus.value = '复制失败，请手动选中文本。'
  }
}

watch(selectedId, () => { copyStatus.value = '' })
onMounted(() => void loadConfiguration())
onUnmounted(() => pending?.abort())
</script>

<template>
  <section id="agent-configuration" class="agent-config" aria-labelledby="agent-config-heading">
    <header class="config-heading">
      <div>
        <h2 id="agent-config-heading">当前 Agent 配置</h2>
        <p>读取本地后端的提示词和工具定义。</p>
      </div>
      <button type="button" class="ghost-button" :disabled="loading" @click="loadConfiguration">刷新配置</button>
    </header>

    <p v-if="loading" class="config-message" role="status">正在读取 Agent 配置…</p>
    <p v-else-if="error" class="error-banner config-error" role="alert">{{ error }}</p>
    <template v-else-if="selected">
      <div class="config-stage-bar" aria-label="选择 Agent 阶段">
        <button v-for="stage in stages" :key="stage.id" type="button" :aria-pressed="stage.id === selectedId" :data-stage="stage.id"
          @click="selectedId = stage.id">{{ stage.label }}</button>
      </div>
      <dl class="config-settings">
        <div><dt>模型</dt><dd>{{ selected.model || '未配置' }}</dd></div>
        <div v-if="selected.temperature != null"><dt>温度</dt><dd>{{ selected.temperature }}</dd></div>
        <div v-if="selected.reasoningEffort"><dt>推理强度</dt><dd>{{ selected.reasoningEffort }}</dd></div>
        <div v-if="selected.runLimit != null"><dt>每次执行的模型调用上限</dt><dd>{{ selected.runLimit }} 次</dd></div>
        <div v-if="selected.choice?.timeoutMs != null"><dt>识别超时</dt><dd>{{ selected.choice.timeoutMs }} ms</dd></div>
        <div v-if="selected.choice?.minConfidence != null"><dt>最低置信度</dt><dd>{{ selected.choice.minConfidence }}</dd></div>
      </dl>
      <div :key="selected.id" class="config-content">
        <section class="config-prompt">
          <div class="config-section-heading">
            <h3>{{ selected.choice ? '语言判定指令' : '系统提示词' }}</h3>
            <button type="button" class="ghost-button config-copy" @click="copyPrompt">复制提示词</button>
          </div>
          <p v-if="copyStatus" class="copy-status" role="status">{{ copyStatus }}</p>
          <pre>{{ prompt }}</pre>
        </section>
        <section class="config-tools">
          <template v-if="selected.choice">
            <div class="config-section-heading"><h3>分类候选</h3><span>{{ Object.keys(selected.choice.criteria).length }} 项</span></div>
            <dl class="config-criteria">
              <div v-for="(description, language) in selected.choice.criteria" :key="language">
                <dt>{{ language }}</dt><dd>{{ description }}</dd>
              </div>
            </dl>
          </template>
          <template v-else>
            <div class="config-section-heading"><h3>工具列表</h3><span>{{ selected.tools.length }} 个</span></div>
            <details v-for="tool in selected.tools" :key="tool.name" class="config-tool">
              <summary><code>{{ tool.name }}</code><span>参数 Schema</span></summary>
              <p v-if="tool.description">{{ tool.description }}</p>
              <pre>{{ JSON.stringify(tool.schema, null, 2) }}</pre>
            </details>
            <p v-if="!selected.tools.length" class="config-message">此阶段的工具列表为空。</p>
          </template>
        </section>
      </div>
    </template>
    <p v-else class="config-message">暂无可显示的 Agent 配置。</p>
  </section>
</template>

<style scoped src="./agent-configuration.css"></style>
