<script setup lang="ts">
import type { SessionSummary } from '../../../entities/session/model/types'

defineProps<{
  collapsed: boolean
  sessions: SessionSummary[]
  activeId: string
  search: string
  loading: boolean
  error: string
  busy: boolean
}>()
const emit = defineEmits<{
  toggle: []
  create: []
  select: [id: string]
  refresh: []
  'update:search': [value: string]
}>()

function updateSearch(event: Event) {
  if (event.target instanceof HTMLInputElement) emit('update:search', event.target.value)
}
function time(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}
</script>

<template>
  <aside
    class="session-sidebar"
    :class="{ 'session-sidebar-collapsed': collapsed }"
    aria-label="会话管理"
  >
    <div class="session-sidebar-heading">
      <span
        v-if="!collapsed"
        class="sidebar-brand"
      >Code2Flow</span>
      <button
        type="button"
        class="sidebar-toggle"
        :aria-label="collapsed ? '展开会话侧栏' : '收起会话侧栏'"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开会话侧栏' : '收起会话侧栏'"
        @click="emit('toggle')"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2"
          />
          <path d="M9 4v16" />
          <path :d="collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'" />
        </svg>
      </button>
    </div>
    <div
      v-show="!collapsed"
      class="session-sidebar-content"
    >
      <button
        type="button"
        class="session-new-button"
        :disabled="busy"
        @click="emit('create')"
      >
        <span aria-hidden="true">＋</span> 新建会话
      </button>
      <label class="session-search-field"><svg
        class="ui-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM15 15l6 6" /></svg><input
        :value="search"
        type="search"
        class="session-search"
        placeholder="搜索会话…"
        aria-label="搜索会话"
        @input="updateSearch"
      ></label>
      <div class="session-list-heading">
        <span>最近会话</span>
        <button
          type="button"
          :disabled="loading"
          aria-label="刷新会话列表"
          @click="emit('refresh')"
        >
          刷新
        </button>
      </div>
      <p
        v-if="error"
        class="session-list-message session-list-error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="loading"
        class="session-list-message"
        role="status"
      >
        正在加载会话…
      </p>
      <p
        v-else-if="!sessions.length"
        class="session-list-message"
      >
        {{ search ? '没有匹配的会话' : '暂无会话，点击上方新建' }}
      </p>
      <div
        class="session-list"
        :aria-busy="loading"
      >
        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          class="session-item"
          :aria-current="session.id === activeId ? 'true' : undefined"
          :disabled="busy || session.busy"
          :title="`${session.title}\n${session.fileName || '直接输入'}\n${session.id}`"
          @click="emit('select', session.id)"
        >
          <strong>{{ session.title }}</strong>
          <span class="sr-only-input">{{ session.language === 'unknown' ? '未确定语言' : session.language }} ·
            {{
              session.busy
                ? '处理中'
                : !session.hasResult
                  ? '未生成'
                  : session.hasDraft
                    ? '待重新生成'
                    : '已生成'
            }}</span>
          <time :datetime="session.updatedAt">{{ time(session.updatedAt) }}</time>
        </button>
      </div>
    </div>
  </aside>
</template>
