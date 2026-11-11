<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  fetchEvaluationSpan, fetchEvaluationTrace, type EvaluationSpanDetail, type EvaluationTrace,
  type EvaluationTraceNode
} from '../../../shared/api/evaluation.api'
import { getErrorMessage } from '../../../shared/lib/errorMessage'

const props = defineProps<{ experimentId: string; sampleIndex: number }>()
const trace = ref<EvaluationTrace | null>(null)
const detail = ref<EvaluationSpanDetail | null>(null)
const selected = ref<EvaluationTraceNode | null>(null)
const mode = ref<'model' | 'tree'>('model')
const tab = ref<'prompt' | 'input' | 'output' | 'parameters'>('prompt')
const loading = ref(false)
const loadingDetail = ref(false)
const error = ref('')
const detailError = ref('')
const expanded = ref(new Set<string>())
let traceRequest: AbortController | undefined
let detailRequest: AbortController | undefined

const labels: Record<string, string> = {
  '<lambda>': '评测样本', evaluateCode2FlowSample: '评测样本',
  'code2flow.evaluate-sample': '执行样本', 'code2flow.multifile': '多文件分析',
  'code2flow.multifile-graph': '分析流程', detectLanguage: '语言识别',
  buildBasicIndex: '源码切块', indexFile: '语义索引', generateUnit: '单元生成',
  resolveReferences: '解析引用', validateUnit: '单元校验', validateResult: '结果校验'
}
const initiallyOpen = new Set(['code2flow.evaluate-sample', 'code2flow.multifile', 'code2flow.multifile-graph'])
const nodesById = computed(() => new Map(trace.value?.nodes.map((node) => [node.id, node])))
const modelNodes = computed(() => trace.value?.nodes.filter((node) => node.kind === 'llm') ?? [])
const children = computed(() => {
  const groups = new Map<string | null, EvaluationTraceNode[]>()
  for (const node of trace.value?.nodes ?? []) {
    const key = node.parentId && nodesById.value.has(node.parentId) ? node.parentId : null
    const group = groups.get(key) ?? []
    group.push(node)
    groups.set(key, group)
  }
  return groups
})
const rows = computed(() => {
  if (mode.value === 'model') return modelNodes.value.map((node) => ({ node, depth: 0, branch: false }))
  const visible: { node: EvaluationTraceNode; depth: number; branch: boolean }[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const node of children.value.get(parentId) ?? []) {
      visible.push({ node, depth, branch: children.value.has(node.id) })
      if (expanded.value.has(node.id)) visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return visible
})

function stageLabel(node: EvaluationTraceNode) {
  let parent = node.parentId ? nodesById.value.get(node.parentId) : undefined
  while (parent) {
    if (parent.name === 'indexFile' || parent.name === 'generateUnit') return labels[parent.name]
    parent = parent.parentId ? nodesById.value.get(parent.parentId) : undefined
  }
  return ''
}

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

async function loadTrace() {
  traceRequest?.abort()
  const request = new AbortController()
  traceRequest = request
  loading.value = true
  error.value = ''
  try {
    const result = await fetchEvaluationTrace(props.experimentId, props.sampleIndex, request.signal)
    if (request.signal.aborted) return
    trace.value = result
    expanded.value = new Set(result.nodes.filter((node) => !node.parentId || initiallyOpen.has(node.name)).map((node) => node.id))
  } catch (cause) {
    if (!request.signal.aborted) error.value = getErrorMessage(cause, '读取 Trace 失败。')
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

async function selectNode(node: EvaluationTraceNode) {
  if (!trace.value) return
  detailRequest?.abort()
  const request = new AbortController()
  detailRequest = request
  selected.value = node
  detail.value = null
  detailError.value = ''
  tab.value = node.kind === 'llm' ? 'prompt' : 'input'
  loadingDetail.value = true
  try {
    const result = await fetchEvaluationSpan(props.experimentId, trace.value.traceId, node.id, request.signal)
    if (!request.signal.aborted) detail.value = result
  } catch (cause) {
    if (!request.signal.aborted) detailError.value = getErrorMessage(cause, '读取步骤明细失败。')
  } finally {
    if (!request.signal.aborted) loadingDetail.value = false
  }
}

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
const json = (value: unknown) => JSON.stringify(value, null, 2)
const roleLabels: Record<string, string> = {
  system: 'System', SystemMessage: 'System',
  human: 'User', user: 'User', HumanMessage: 'User',
  ai: 'Assistant', assistant: 'Assistant', AIMessage: 'Assistant', AIMessageChunk: 'Assistant',
  tool: 'Tool', ToolMessage: 'Tool'
}

function messageText(content: unknown) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: unknown) => {
    const block = object(part)
    return block?.type === 'text' && typeof block.text === 'string' ? block.text : json(part)
  }).join('\n')
  return content == null ? '' : json(content)
}

const prompts = computed(() => {
  const input = detail.value?.input
  if (!input) return []
  const messages = Array.isArray(input.messages) ? (input.messages as unknown[]).flat() : []
  const result = messages.flatMap((message) => {
    const item = object(message)
    if (!item) return []
    const data = object(item.kwargs) ?? item
    const identifier = Array.isArray(item.id) ? item.id[item.id.length - 1] : item.role ?? item.type
    const role = typeof identifier === 'string' ? roleLabels[identifier] ?? identifier : 'Message'
    const content = messageText(data.content)
    const toolCalls = data.tool_calls ?? object(data.additional_kwargs)?.tool_calls
    return [{ role, content: toolCalls ? [content, json(toolCalls)].filter(Boolean).join('\n\n') : content }]
  })
  if (result.length) return result
  const textPrompts = Array.isArray(input.prompts) ? input.prompts : [input.prompt]
  return textPrompts.flatMap((prompt) => typeof prompt === 'string' ? [{ role: 'Prompt', content: prompt }] : [])
})

const number = new Intl.NumberFormat('zh-CN')
const duration = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
const tokens = (count: number | null) => count === null ? '—' : number.format(count)
const hasParameters = computed(() => Object.keys(detail.value?.parameters ?? {}).length > 0)
const raw = computed(() => {
  if (tab.value === 'input') return detail.value?.input
  if (tab.value === 'output') return detail.value?.output
  return detail.value?.parameters
})

onMounted(() => void loadTrace())
onUnmounted(() => {
  traceRequest?.abort()
  detailRequest?.abort()
})
</script>

<template>
  <section class="trace-view" aria-label="样本 Trace">
    <p v-if="loading" class="trace-note" role="status">正在读取 LangSmith Trace…</p>
    <div v-else-if="error" class="trace-load-error">
      <p class="error-banner" role="alert">{{ error }}</p>
      <button class="ghost-button" type="button" @click="loadTrace">重试</button>
    </div>
    <template v-else-if="trace?.nodes.length">
      <div class="trace-toolbar">
        <div class="trace-tabs" aria-label="Trace 筛选">
          <button type="button" :aria-pressed="mode === 'model'" @click="mode = 'model'">模型调用 {{ modelNodes.length }}</button>
          <button type="button" :aria-pressed="mode === 'tree'" @click="mode = 'tree'">完整执行树 {{ trace.nodes.length }}</button>
        </div>
      </div>
      <div class="trace-grid">
        <div class="trace-tree" aria-label="执行步骤">
          <p v-if="!rows.length" class="trace-note">这条 Trace 中没有模型调用。</p>
          <div v-for="{ node, depth, branch } in rows" :key="node.id" class="trace-node"
            :class="{ 'trace-node-active': selected?.id === node.id }" :style="{ paddingInlineStart: `${4 + Math.min(depth, 12) * 9}px` }">
            <button v-if="branch" type="button" class="trace-expand" :aria-expanded="expanded.has(node.id)"
              :aria-label="`${expanded.has(node.id) ? '收起' : '展开'} ${labels[node.name] ?? node.name}`" @click="toggle(node.id)">
              {{ expanded.has(node.id) ? '▾' : '▸' }}
            </button>
            <button type="button" class="trace-node-select" :aria-pressed="selected?.id === node.id" @click="selectNode(node)">
              <span class="trace-node-title">
                <strong>{{ mode === 'model' ? node.model ?? node.name : labels[node.name] ?? node.name }}</strong>
                <small v-if="mode === 'model' && stageLabel(node)">{{ stageLabel(node) }}</small>
                <small v-if="node.status === 'error'" class="trace-error-text">失败</small>
              </span>
              <span class="trace-node-metric">
                <span>{{ duration(node.durationMs) }}</span>
                <small v-if="node.kind === 'llm'">{{ tokens(node.totalTokens) }} Token</small>
              </span>
            </button>
          </div>
        </div>

        <div class="trace-detail">
          <p v-if="!selected" class="trace-note">选择一个步骤查看 Input 和 Output。模型调用还可以查看 Prompt。</p>
          <template v-else>
            <div class="trace-detail-heading">
              <strong>{{ selected.model ?? labels[selected.name] ?? selected.name }}</strong>
              <span>{{ duration(selected.durationMs) }}<template v-if="selected.kind === 'llm'"> · 输入 {{ tokens(selected.inputTokens) }} · 输出 {{ tokens(selected.outputTokens) }} Token</template></span>
              <span v-if="selected.taskId" class="trace-task">{{ selected.taskId }}<template v-if="selected.attempt !== null"> · 第 {{ selected.attempt }} 次</template></span>
            </div>
            <p v-if="loadingDetail" class="trace-note" role="status">正在读取该步骤的输入和输出…</p>
            <div v-else-if="detailError" class="trace-load-error">
              <p class="error-banner" role="alert">{{ detailError }}</p>
              <button class="ghost-button" type="button" @click="selectNode(selected)">重试</button>
            </div>
            <template v-else-if="detail">
              <div class="trace-tabs trace-payload-tabs" aria-label="步骤详情">
                <button v-if="selected.kind === 'llm'" type="button" :aria-pressed="tab === 'prompt'" @click="tab = 'prompt'">Prompt</button>
                <button type="button" :aria-pressed="tab === 'input'" @click="tab = 'input'">Input</button>
                <button type="button" :aria-pressed="tab === 'output'" @click="tab = 'output'">Output</button>
                <button v-if="hasParameters" type="button" :aria-pressed="tab === 'parameters'" @click="tab = 'parameters'">参数与工具</button>
              </div>
              <p v-if="detail.error" class="error-banner trace-span-error" role="alert">{{ detail.error }}</p>
              <div v-if="tab === 'prompt'" class="trace-messages">
                <p v-if="!prompts.length" class="trace-note">这次调用没有记录可展示的 Prompt 消息，可切到 Input 查看原始数据。</p>
                <section v-for="(message, index) in prompts" :key="index" class="trace-message">
                  <h4>{{ message.role }}</h4>
                  <pre>{{ message.content || '（空消息）' }}</pre>
                </section>
              </div>
              <pre v-else-if="raw != null" class="trace-raw">{{ json(raw) }}</pre>
              <p v-else class="trace-note">LangSmith 未记录这个字段。</p>
            </template>
          </template>
        </div>
      </div>
    </template>
    <p v-else class="trace-note">这条样本暂无执行步骤。</p>
  </section>
</template>

<style scoped src="./evaluation-trace.css"></style>
