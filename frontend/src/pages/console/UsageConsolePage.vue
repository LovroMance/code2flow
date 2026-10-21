<script setup lang="ts">
import { useUsageConsole } from '../../features/usage-console/model/useUsageConsole'

const { data, loading, error, refresh } = useUsageConsole()
const numberFormat = new Intl.NumberFormat('zh-CN')
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
  hour12: false
})
const usageLabels = {
  complete: '',
  partial: '部分用量',
  missing: '未返回',
  unknown: '历史用量完整性未知'
}
function tokens(value: number | null) {
  return value === null ? '未返回' : numberFormat.format(value)
}
</script>

<template>
  <section
    class="usage-console"
    aria-labelledby="usage-title"
    :aria-busy="loading"
  >
    <header class="usage-header">
      <div>
        <p class="usage-kicker">
          USAGE / 用量记录
        </p>
        <h1 id="usage-title">
          生成用量
        </h1>
        <p class="usage-description">
          最近 50 次 DeepSeek 流程图生成，包含重试消耗，不含 Jev 语言识别和追问。
        </p>
      </div>
      <button
        class="ghost-button"
        type="button"
        :disabled="loading"
        @click="refresh"
      >
        {{ loading ? '加载中…' : '刷新' }}
      </button>
    </header>

    <p
      v-if="error"
      class="error-banner"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="data && !data.tracingEnabled"
      class="usage-notice"
      role="status"
    >
      用量记录已关闭：以下仅展示历史记录，新生成不会保存用量。启用 CODE2FLOW_TRACE
      后重启后端可恢复记录。
    </p>
    <p
      v-if="data?.scanLimited"
      class="usage-notice"
    >
      记录较多，仅扫描日志末尾 4 MiB，展示其中最近 50 次生成。
    </p>
    <p
      v-if="loading && !data"
      class="usage-empty"
      role="status"
    >
      正在加载用量记录…
    </p>
    <p
      v-else-if="data && !data.records.length"
      class="usage-empty"
    >
      暂无生成记录。完成一次流程图生成后，回到这里刷新查看。
    </p>

    <div
      v-if="data?.records.length"
      class="usage-table-wrap"
    >
      <table class="usage-table">
        <caption class="sr-only-input">
          每次流程图生成的 DeepSeek token 用量
        </caption>
        <thead>
          <tr>
            <th scope="col">
              开始时间
            </th>
            <th scope="col">
              模型
            </th>
            <th scope="col">
              状态
            </th>
            <th
              scope="col"
              class="usage-number"
            >
              输入 tokens
            </th>
            <th
              scope="col"
              class="usage-number"
            >
              输出 tokens
            </th>
            <th
              scope="col"
              class="usage-number"
            >
              总 tokens
            </th>
            <th
              scope="col"
              class="usage-number"
            >
              重试
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in data.records"
            :key="record.runId"
          >
            <td>
              <time :datetime="record.startedAt">{{
                dateFormat.format(new Date(record.startedAt))
              }}</time>
              <small v-if="record.source === 'unknown'">历史记录，来源未知</small>
            </td>
            <td>
              <span>{{
                record.responseModels.length
                  ? record.responseModels.join(' / ')
                  : record.requestedModel
              }}</span>
              <small>{{
                record.responseModels.length
                  ? `响应模型 · 请求 ${record.requestedModel}`
                  : '请求模型'
              }}</small>
            </td>
            <td>
              <span :class="record.outcome === 'success' ? 'usage-success' : 'usage-failure'">{{
                record.outcome === 'success' ? '成功' : '失败'
              }}</span>
            </td>
            <td class="usage-number">
              {{ tokens(record.promptTokens) }}
            </td>
            <td class="usage-number">
              {{ tokens(record.completionTokens) }}
            </td>
            <td class="usage-number usage-total">
              {{ tokens(record.totalTokens) }}
              <small v-if="usageLabels[record.completeness]">{{
                usageLabels[record.completeness]
              }}</small>
            </td>
            <td class="usage-number">
              {{ record.retryCount }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p
      v-if="data?.records.length"
      class="usage-footnote"
    >
      用量来自模型接口返回值；部分或未返回的用量不代表完整账单。生成结束后点击刷新更新列表。
    </p>
  </section>
</template>

<style scoped>
.usage-console {
  height: 100%;
  overflow: auto;
  padding: 28px 24px;
}
.usage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.usage-kicker {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--accent);
}
h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
}
.usage-description,
.usage-footnote {
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.7;
}
.usage-description {
  margin: 10px 0 0;
}
.usage-notice {
  padding: 12px 16px;
  border: 1px solid var(--border);
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.7;
}
.usage-empty {
  padding: 70px 16px;
  text-align: center;
  color: var(--text-soft);
  border: 1px dashed var(--border);
}
.usage-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-size: 13px;
}
th {
  color: var(--text-muted);
  font-weight: 500;
  background: var(--bg-panel);
}
th,
td {
  padding: 16px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: var(--bg-panel);
}
small {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}
.usage-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.usage-total,
.usage-success {
  color: var(--accent);
}
.usage-failure {
  color: #edaaa1;
}
.usage-footnote {
  margin-top: 16px;
}
@media (max-width: 640px) {
  .usage-console {
    padding: 20px 14px;
  }
  .usage-header {
    align-items: flex-start;
  }
}
</style>
