<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { SourceFileInput } from '../../entities/flow/model/multifile'
import { equalSourceFiles } from '../../features/workspace/model/sourceFiles'
import { previewChunks } from '../../shared/api/multifile.api'
import { chineseErrorMessage } from '../../shared/lib/errorMessage'

const props = defineProps<{ files: SourceFileInput[]; sessionId: string; busy: boolean }>()
const emit = defineEmits<{ back: [] }>()

type Preview = Awaited<ReturnType<typeof previewChunks>>
type Chunk = Preview['files'][number]['chunks'][number]

const run = shallowRef<{ input: SourceFileInput[]; result: Preview }>()
const loading = ref(false)
const error = ref('')
const copyStatus = ref('')
const fileIndex = ref(0)
const chunkIndex = ref(0)
const expandedFile = ref(0)
let request: AbortController | undefined

const result = computed(() => run.value?.result)
const stale = computed(() => !!run.value && !equalSourceFiles(props.files, run.value.input))
const totalChunks = computed(() => result.value?.files.reduce((sum, file) => sum + file.chunks.length, 0))
const file = computed(() => result.value?.files[fileIndex.value])
const chunk = computed(() => file.value?.chunks[chunkIndex.value])
const previousChunk = computed(() => file.value?.chunks[chunkIndex.value - 1])
const content = computed(() =>
  chunk.value && file.value
    ? file.value.content.slice(chunk.value.startOffset, chunk.value.endOffset)
    : ''
)
const lines = computed(() => {
  const selected = chunk.value
  if (!selected) return []
  const parts = content.value.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []
  const overlapEnd = previousChunk.value?.endOffset ?? selected.startOffset
  let offset = selected.startOffset
  return parts.map((part, index) => {
    const text = part.replace(/(?:\r\n|\r|\n)$/, '')
    const overlapLength = Math.max(0, overlapEnd - offset)
    offset += part.length
    return {
      number: selected.lineStart + index,
      fullOverlap: overlapLength >= part.length,
      overlap: text.slice(0, overlapLength),
      rest: text.slice(overlapLength)
    }
  })
})

function lastCoveredLine(item: Chunk) {
  return item.lineEnd - (item.columnEnd === 1 ? 1 : 0)
}

function lineRange(item: Chunk) {
  const lastLine = lastCoveredLine(item)
  return lastLine === item.lineStart ? `第 ${lastLine} 行` : `第 ${item.lineStart}–${lastLine} 行`
}

function chunkSize(item: Chunk) {
  const lineCount = lastCoveredLine(item) - item.lineStart + 1
  const charCount = item.endOffset - item.startOffset
  return `${lineCount} 行 · ${charCount} 字符`
}

function selectFile(index: number) {
  expandedFile.value = expandedFile.value === index ? -1 : index
  if (fileIndex.value !== index) {
    fileIndex.value = index
    chunkIndex.value = 0
  }
}

async function runPreview() {
  if (loading.value || props.busy || props.files.length < 2) return
  const controller = new AbortController()
  const input = props.files.map(({ path, content }) => ({ path, content }))
  request = controller
  loading.value = true
  error.value = ''
  try {
    const result = await previewChunks(input, controller.signal)
    if (controller.signal.aborted) return
    run.value = { input, result }
    fileIndex.value = 0
    chunkIndex.value = 0
    expandedFile.value = 0
  } catch (cause) {
    if (!controller.signal.aborted) error.value = chineseErrorMessage(cause, '切块失败，请重试。')
  } finally {
    if (request === controller) {
      request = undefined
      loading.value = false
    }
  }
}

async function copySource() {
  const selected = chunk.value
  let message = '已复制源码'
  try {
    await navigator.clipboard.writeText(content.value)
  } catch {
    message = '复制失败，请手动选中源码复制。'
  }
  if (chunk.value === selected) copyStatus.value = message
}

watch(chunk, () => {
  copyStatus.value = ''
})
watch(
  () => props.sessionId,
  () => {
    request?.abort()
    run.value = undefined
    error.value = ''
  }
)
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <section class="workspace-stage session-workspace" :aria-busy="loading || busy">
    <header class="session-header">
      <div class="session-heading-copy">
        <span class="session-breadcrumb">开发调试 <span>/</span></span>
        <h1>多文件切块</h1>
      </div>
      <div class="session-header-actions">
        <button type="button" class="ghost-button" @click="emit('back')">返回工作台</button>
      </div>
    </header>

    <div class="debug-toolbar">
      <span>当前会话 · {{ files.length }} 个文件</span>
      <span v-if="result" class="debug-config" title="每块行数与 UTF-16 字符数上限">
        {{ result.chunkLines }} 行 / {{ result.chunkChars }} 字符
      </span>
      <button type="button" class="primary-button" :disabled="loading || busy || files.length < 2"
        @click="runPreview">
        {{ loading ? '切块中…' : '运行切块' }}
      </button>
    </div>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <p v-if="result" class="debug-summary" role="status">
      <span class="debug-dot" :class="{ 'debug-dot-stale': stale }" />
      {{ stale ? '源码已修改 · 待重新切块' : '切块完成' }}
      · {{ result.files.length }} 个文件 · {{ totalChunks }} 个块
    </p>

    <div v-if="result" class="debug-results">
      <section class="debug-file-list" aria-label="文件与分块">
        <h2>文件与分块</h2>
        <div v-for="(item, index) in result.files" :key="item.path" class="debug-file">
          <button type="button" class="debug-row debug-file-button" :aria-expanded="expandedFile === index"
            :title="item.path" @click="selectFile(index)">
            <span aria-hidden="true">{{ expandedFile === index ? '▾' : '▸' }}</span>
            <strong>{{ item.path }}</strong>
            <span>{{ item.chunks.length }} 块</span>
          </button>
          <template v-if="expandedFile === index">
            <button v-for="(range, position) in item.chunks" :key="range.chunkId" type="button"
              class="debug-row debug-chunk-button" :aria-pressed="fileIndex === index && chunkIndex === position"
              @click="chunkIndex = position">
              <span>#{{ String(position + 1).padStart(2, '0') }}</span>
              <span>
                {{ lineRange(range) }}
                <small class="debug-chunk-size">{{ chunkSize(range) }}</small>
              </span>
            </button>
          </template>
        </div>
      </section>

      <section v-if="chunk && file" class="debug-source" aria-label="分块源码">
        <header>
          <div>
            <h2>{{ file.path }} · 第 {{ chunkIndex + 1 }} 块</h2>
            <p>
              {{ lineRange(chunk) }} · {{ chunkSize(chunk) }}
              <span v-if="previousChunk && previousChunk.endOffset > chunk.startOffset" class="debug-legend">
                与上一块重叠
              </span>
            </p>
          </div>
          <div class="debug-copy">
            <span role="status">{{ copyStatus }}</span>
            <button type="button" class="ghost-button" @click="copySource">复制源码</button>
          </div>
        </header>
        <pre class="debug-code" tabindex="0" aria-label="带原始行号的分块源码"><code><span
          v-for="line in lines" :key="line.number" class="debug-line" :class="{ 'debug-overlap': line.fullOverlap }"
        ><span class="debug-line-number" aria-hidden="true">{{ line.number }}</span><span><mark
          v-if="line.overlap" class="debug-overlap"
        >{{ line.overlap }}</mark>{{ line.rest }}</span></span></code></pre>
        <details class="debug-details">
          <summary>块详情</summary>
          <div>
            <span>预览块 ID {{ chunk.chunkId }}</span>
            <span>切块版本 {{ chunk.chunkerVersion }}</span>
            <span>行列 {{ chunk.lineStart }}:{{ chunk.columnStart }} – {{ chunk.lineEnd }}:{{ chunk.columnEnd }}（结束位置不含）</span>
            <span>UTF-16 偏移 [{{ chunk.startOffset }}, {{ chunk.endOffset }})</span>
          </div>
        </details>
      </section>
    </div>
    <p v-else class="session-message-empty debug-empty">
      {{ busy ? '正在加载当前会话…' : files.length < 2
        ? '请返回工作台，上传至少两个代码文件。'
        : '点击「运行切块」查看当前文件的分块结果。' }}
    </p>
  </section>
</template>

<style scoped>
.debug-toolbar,
.debug-summary {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.debug-toolbar > :first-child {
  margin-right: auto;
}
.debug-config,
.debug-source p,
.debug-copy,
.debug-row > span,
.debug-details {
  color: var(--text-soft);
  font-size: 12px;
}
.debug-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.debug-dot-stale {
  background: var(--text-muted);
}
.debug-results {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(220px, 25%) minmax(0, 1fr);
  min-height: 0;
}
.debug-file-list {
  overflow: auto;
  border-right: 1px solid var(--border);
}
.debug-results h2 {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.debug-file-list h2 {
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
}
.debug-file {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
}
.debug-results .debug-row {
  justify-content: flex-start;
  width: 100%;
  min-height: 34px;
  padding: 4px 8px;
  border: 0;
  border-inline-start: 2px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  text-align: left;
  font-size: 13px;
}
.debug-row:hover {
  background: var(--bg-inset);
}
.debug-row strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debug-row > span {
  flex: 0 0 auto;
}
.debug-results .debug-chunk-button {
  padding-inline-start: 24px;
  gap: 16px;
}
.debug-chunk-size {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
}
.debug-row[aria-pressed='true'] {
  border-inline-start-color: var(--accent);
  background: var(--debug-highlight);
}
.debug-source {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.debug-source header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.debug-source p {
  margin: 4px 0 0;
}
.debug-copy {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
.debug-legend {
  margin-left: 10px;
}
.debug-legend::before {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  background: var(--debug-highlight);
  content: '';
}
.debug-code {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 8px 0;
  font: 13px/1.65 Consolas, 'Courier New', monospace;
}
.debug-code code {
  display: block;
  width: max-content;
  min-width: 100%;
  font: inherit;
}
.debug-line {
  display: block;
  min-height: 1.65em;
  padding-right: 16px;
  tab-size: 4;
}
.debug-line-number {
  display: inline-block;
  width: 5ch;
  margin-right: 2ch;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
}
.debug-overlap {
  background: var(--debug-highlight);
  color: inherit;
}
.debug-details {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}
.debug-details summary {
  cursor: pointer;
}
.debug-details div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding-top: 8px;
}
.debug-empty {
  padding: 20px;
}
</style>
