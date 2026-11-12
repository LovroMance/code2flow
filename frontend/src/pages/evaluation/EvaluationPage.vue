<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEvaluation } from '../../features/evaluation/model/useEvaluation'
import AgentConfiguration from '../../features/evaluation/ui/AgentConfiguration.vue'
import { evaluationTraceLink, type EvaluationRun } from '../../shared/api/evaluation.api'

const emit = defineEmits<{ back: [] }>()
const {
  datasets, datasetId, experimentName, runs, selectedRunId, selectedRun, baselineId, baseline,
  baselines, loading, loadingHistory, starting, error, activeRun, loadDatasets, runEvaluation
} = useEvaluation()
const configurationOpen = ref(false)

const stateNames = { running: '运行中', completed: '已完成', failed: '有失败', interrupted: '已中断' }
const stages: Record<string, string> = {
  prepare: '准备源码', detect: '语言识别', basic: '源码切块', index: '语义索引',
  resolve: '解析引用', generate: '生成与校验'
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const numberFormat = new Intl.NumberFormat('zh-CN')
const number = (value: number | null) => value === null ? '—' : numberFormat.format(value)
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`
const date = (value: string) => timeFormat.format(new Date(value))
const deltaText = (delta: number, format: (value: number) => string) =>
  `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${format(Math.abs(delta))}`

function summarize(run?: EvaluationRun) {
  if (!run?.cases.length) return null
  const sum = (key: 'diagnosticCount' | 'inputTokens' | 'outputTokens' | 'totalTokens') =>
    run.cases.some((sample) => sample[key] == null) ? null : run.cases.reduce((n, sample) => n + (sample[key] ?? 0), 0)
  return {
    duration: run.cases.reduce((n, sample) => n + sample.durationMs, 0),
    calls: run.cases.reduce((n, sample) => n + sample.modelCalls, 0),
    diagnostics: sum('diagnosticCount'),
    input: sum('inputTokens'), output: sum('outputTokens'), tokens: sum('totalTokens')
  }
}
const result = computed(() => summarize(selectedRun.value))
const reference = computed(() => summarize(baseline.value))
const referenceCases = computed(() => new Map(baseline.value?.cases.map((sample) => [sample.caseId, sample])))
const progress = computed(() => activeRun.value?.progress)
const metrics = computed(() => {
  const current = result.value
  const previous = reference.value
  if (!current) return []
  return [
    { label: '诊断总条数', value: number(current.diagnostics), delta: current.diagnostics !== null && previous?.diagnostics != null ? current.diagnostics - previous.diagnostics : null, format: number },
    { label: '累计分析耗时', value: seconds(current.duration), delta: previous ? current.duration - previous.duration : null, format: seconds },
    { label: '模型调用', value: number(current.calls), delta: previous ? current.calls - previous.calls : null, format: number },
    { label: '输入 Token', value: number(current.input), delta: current.input !== null && previous?.input != null ? current.input - previous.input : null, format: number },
    { label: '输出 Token', value: number(current.output), delta: current.output !== null && previous?.output != null ? current.output - previous.output : null, format: number },
    { label: '总 Token', value: number(current.tokens), delta: current.tokens !== null && previous?.tokens != null ? current.tokens - previous.tokens : null, format: number }
  ]
})
</script>

<template>
  <div class="evaluation-page">
    <header class="evaluation-header">
      <a class="workspace-back" href="/" @click.exact.prevent="emit('back')">← 返回工作区</a>
      <div class="evaluation-title-row">
        <div>
          <h1>Agent 评测</h1>
          <p>使用 LangSmith 数据集比较诊断条数、分析耗时、模型调用次数和 Token 用量。</p>
        </div>
        <div class="evaluation-header-actions">
          <button class="ghost-button" type="button" :aria-expanded="configurationOpen" aria-controls="agent-configuration"
            @click="configurationOpen = !configurationOpen">Agent 配置</button>
          <button class="ghost-button" type="button" :disabled="loading || loadingHistory || starting" @click="loadDatasets">刷新数据</button>
        </div>
      </div>
    </header>

    <div class="evaluation-content">
      <AgentConfiguration v-if="configurationOpen" />
      <form class="evaluation-form evaluation-panel" @submit.prevent="runEvaluation">
        <label>
          <span>LangSmith 数据集</span>
          <select v-model="datasetId" :disabled="loading || starting">
            <option value="" disabled>{{ loading ? '正在读取数据集…' : '选择数据集' }}</option>
            <option v-for="dataset in datasets" :key="dataset.id" :value="dataset.id">
              {{ dataset.name }}{{ dataset.exampleCount !== null ? ` · ${dataset.exampleCount} 条样本` : '' }}
            </option>
          </select>
        </label>
        <label>
          <span>实验名称 <small>选填</small></span>
          <input v-model="experimentName" maxlength="80" placeholder="例如 合并索引与生成" :disabled="starting" />
        </label>
        <button class="primary-button" type="submit" :disabled="!datasetId || starting || !!activeRun">
          {{ starting || activeRun ? '评测运行中…' : '开始评测' }}
        </button>
      </form>

      <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      <p v-else-if="!loading && !datasets.length" class="evaluation-note">请先在 LangSmith 添加数据集和源码样本。</p>
      <div v-if="activeRun" class="running-banner" role="status">
        <span class="running-dot" aria-hidden="true" />
        <span>{{ activeRun.totalCases ? `已完成 ${activeRun.cases.length} / ${activeRun.totalCases} 条样本` : 'LangSmith 正在准备实验…' }}</span>
        <span v-if="progress">{{ stages[progress.stage] || progress.stage }} · {{ progress.completed }} / {{ progress.total }}</span>
      </div>

      <div class="evaluation-grid">
        <section class="evaluation-panel history-panel" aria-labelledby="history-heading">
          <div class="evaluation-section-header"><h2 id="history-heading">实验记录</h2></div>
          <p v-if="loadingHistory" class="evaluation-note" role="status">正在读取实验记录…</p>
          <p v-else-if="!runs.length" class="evaluation-note">选择数据集并开始评测后，实验会出现在这里。</p>
          <div class="evaluation-history">
            <button v-for="run in runs" :key="run.id" type="button" :aria-pressed="selectedRunId === run.id"
              class="history-entry" @click="selectedRunId = run.id">
              <span class="history-entry-title">{{ run.name || '新实验' }}</span>
              <span class="history-entry-meta"><time :datetime="run.createdAt">{{ date(run.createdAt) }}</time><span :data-state="run.status">{{ stateNames[run.status] }}</span></span>
            </button>
          </div>
        </section>

        <section class="evaluation-panel detail-panel" aria-labelledby="result-heading">
          <div class="evaluation-section-header">
            <h2 id="result-heading">实验结果</h2>
            <a v-if="selectedRun?.experimentUrl" :href="selectedRun.experimentUrl" target="_blank" rel="noopener noreferrer">在 LangSmith 查看 ↗</a>
          </div>
          <template v-if="selectedRun">
            <div class="run-heading">
              <div>
                <h3>{{ selectedRun.name || '新实验' }}</h3>
                <span class="run-meta">{{ selectedRun.cases.length }} / {{ selectedRun.totalCases }} 条样本<span v-if="selectedRun.model"> · {{ selectedRun.model }}</span></span>
              </div>
              <label v-if="baselines.length && selectedRun.status !== 'running'" class="baseline-select">
                <span>对比基线</span>
                <select v-model="baselineId">
                  <option value="">选择实验</option>
                  <option v-for="run in baselines" :key="run.id" :value="run.id">{{ run.name }} · {{ date(run.createdAt) }}</option>
                </select>
              </label>
            </div>
            <p v-if="selectedRun.error" class="error-banner" role="alert">{{ selectedRun.error }}</p>
            <dl v-if="metrics.length" class="result-metrics">
              <div v-for="metric in metrics" :key="metric.label">
                <dt>{{ metric.label }}</dt>
                <dd>{{ metric.value }}</dd>
                <dd v-if="metric.delta !== null" class="metric-delta" :class="{ faster: metric.delta < 0 }">
                  {{ deltaText(metric.delta, metric.format) }}
                </dd>
              </div>
            </dl>
            <p v-else class="evaluation-note">{{ selectedRun.status === 'running' ? '样本运行完成后会显示数据。' : '此实验暂无样本结果。' }}</p>

            <div v-if="selectedRun.cases.length" class="sample-results">
              <h3>样本结果</h3>
              <article v-for="(sample, index) in selectedRun.cases" :key="`${selectedRun.id}-${index}`" class="sample">
                <header class="sample-heading">
                  <div class="sample-heading-info">
                    <strong>{{ sample.caseId }}</strong>
                    <span>{{ seconds(sample.durationMs) }} · {{ number(sample.totalTokens) }} Token</span>
                    <span v-if="sample.status === 'failed'" class="sample-error">分析失败</span>
                  </div>
                  <a v-if="selectedRun.experimentId" class="ghost-button sample-trace-link"
                    :href="evaluationTraceLink(selectedRun.experimentId, index)" target="_blank" rel="noopener noreferrer"
                    :aria-label="`在 LangSmith 查看 ${sample.caseId} 的 Trace`">LangSmith Trace ↗</a>
                </header>
                <div class="sample-metrics">
                  <span>诊断条数 {{ number(sample.diagnosticCount ?? null) }}</span>
                  <span>模型调用 {{ number(sample.modelCalls) }} 次</span>
                  <span>输入 {{ number(sample.inputTokens) }} Token</span>
                  <span>输出 {{ number(sample.outputTokens) }} Token</span>
                  <span v-if="referenceCases.has(sample.caseId)">
                    耗时较基线 {{ deltaText(sample.durationMs - referenceCases.get(sample.caseId)!.durationMs, seconds) }}
                  </span>
                </div>
                <p v-if="sample.error" class="error-banner">{{ sample.error }}</p>
              </article>
            </div>
          </template>
          <p v-else class="evaluation-note">运行或选择一条实验记录，查看评测指标。</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped src="./evaluation.css"></style>
