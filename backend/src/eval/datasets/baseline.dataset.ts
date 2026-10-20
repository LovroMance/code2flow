import type { EvalDataset } from '../dataset.types'

// 基线数据集：覆盖控制流、异步、Vue 响应式、错误处理、边界输入五类场景。
// 期望值故意写得宽松（只断言必须出现/不能出现），避免因为措辞差异造成假失败。
export const baselineDataset: EvalDataset = {
  name: 'baseline',
  cases: [
    {
      id: 'js-async-branch',
      name: 'JS 异步 + 条件分支',
      language: 'javascript',
      tags: ['control-flow', 'async'],
      code: `async function loadUser(userId) {
  const user = await fetchUser(userId)

  if (!user) {
    throw new Error('user not found')
  }

  if (user.isActive) {
    return goToDashboard(user)
  }

  showInactiveMessage(user)
  return null
}`,
      expectation: {
        mustHaveKinds: ['start', 'action', 'decision'],
        mustContainLabels: ['用户'],
        minMappings: 3,
        validLineRange: true
      }
    },
    {
      id: 'js-loop-early-return',
      name: 'JS 循环 + 提前返回',
      language: 'javascript',
      tags: ['control-flow', 'loop'],
      code: `function findFirstMatch(items, target) {
  for (const item of items) {
    if (item.id === target) {
      return item
    }
  }

  return null
}`,
      expectation: {
        mustHaveKinds: ['decision', 'return'],
        minMappings: 3,
        validLineRange: true
      }
    },
    {
      id: 'js-try-catch',
      name: 'JS 异常处理',
      language: 'javascript',
      tags: ['error-handling'],
      code: `async function saveOrder(order) {
  try {
    const saved = await api.createOrder(order)
    return saved
  } catch (error) {
    logger.error('create order failed', error)
    throw error
  }
}`,
      expectation: {
        mustHaveKinds: ['action'],
        minMappings: 2,
        validLineRange: true
      }
    },
    {
      id: 'ts-switch-typeguard',
      name: 'TS switch 分支',
      language: 'typescript',
      tags: ['control-flow', 'typescript'],
      code: `interface Payload {
  kind: 'text' | 'image'
  value: string
}

function renderPayload(payload: Payload): string {
  switch (payload.kind) {
    case 'text':
      return payload.value
    case 'image':
      return renderImage(payload.value)
    default:
      return ''
  }
}`,
      expectation: {
        mustHaveKinds: ['decision'],
        minMappings: 3,
        validLineRange: true
      }
    },
    {
      id: 'vue-lifecycle-watch',
      name: 'Vue 生命周期 + watch',
      language: 'vue',
      tags: ['vue', 'reactive'],
      code: `<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const keyword = ref('')
const list = ref([])

onMounted(() => {
  loadList()
})

watch(keyword, async (next) => {
  await loadList(next)
})

async function loadList(next = '') {
  list.value = await api.search(next)
}
</script>`,
      expectation: {
        mustHaveKinds: ['action'],
        minMappings: 3,
        validLineRange: true
      }
    },
    {
      id: 'vue-computed-side-effect',
      name: 'Vue computed + 状态派生',
      language: 'vue',
      tags: ['vue', 'reactive'],
      code: `<script setup lang="ts">
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)

function increment() {
  if (count.value >= 10) {
    reset()
    return
  }

  count.value += 1
}

function reset() {
  count.value = 0
}
</script>`,
      expectation: {
        mustHaveKinds: ['decision'],
        minMappings: 3,
        validLineRange: true
      }
    },
    {
      id: 'edge-empty',
      name: '边界：空代码',
      language: 'unknown',
      tags: ['edge'],
      code: '   ',
      expectation: {
        minMappings: 0,
        validLineRange: true
      }
    },
    {
      id: 'edge-comment-only',
      name: '边界：仅注释',
      language: 'javascript',
      tags: ['edge'],
      code: `// 这里只有注释
// 没有可执行语句
/* 块注释 */`,
      expectation: {
        minMappings: 0,
        validLineRange: true
      }
    },
    {
      id: 'edge-single-line',
      name: '边界：单行代码',
      language: 'javascript',
      tags: ['edge'],
      code: 'const answer = 42',
      expectation: {
        minMappings: 1,
        validLineRange: true
      }
    },
    {
      id: 'js-nested-conditions',
      name: 'JS 嵌套条件',
      language: 'javascript',
      tags: ['control-flow', 'complex'],
      code: `function resolveAccess(user, resource) {
  if (!user) {
    return 'anonymous'
  }

  if (user.role === 'admin') {
    return 'full'
  }

  if (resource.isPublic) {
    return 'read'
  }

  return 'none'
}`,
      expectation: {
        mustHaveKinds: ['decision', 'return'],
        minMappings: 4,
        validLineRange: true
      }
    }
  ]
}
