import type { SupportedLanguage } from '../../domain/flow/types'

export function buildLanguageSpecificSystemPrompt(language: SupportedLanguage) {
  switch (language) {
    case 'javascript':
    case 'typescript':
      return `
当前代码语言是 ${language}。
请优先按现代前端/Node 风格理解控制流。
重点识别：
- async / await、Promise 链
- if / else、switch、循环、早返回
- 函数调用、副作用、异常处理
节点标签优先用简洁自然语言，不要机械复制整行代码。
`.trim()

    case 'vue':
      return `
当前代码语言是 vue。
请按 Vue 单文件组件或 script setup 语境理解控制流。
重点识别：
- onMounted、onUnmounted
- watch、watchEffect
- ref、reactive、computed 的关键状态变化
- 事件处理函数、异步请求、副作用链
节点标签优先使用简洁自然语言。
`.trim()

    case 'java':
    case 'c':
    case 'cpp':
    case 'python':
    case 'go':
    case 'rust':
    case 'csharp':
    case 'php':
      return `
当前代码语言是 ${language}。
请按通用后端/系统语言语境理解控制流。
重点识别：
- 函数/方法入口
- 条件分支、循环、返回分支
- try / catch 或同类异常处理
- 重要方法调用与状态变更
节点标签优先使用简洁自然语言，避免直接照抄语法结构。
`.trim()

    default:
      return `
当前代码语言尚不明确，请按通用程序控制流理解代码。
重点识别函数入口、条件分支、循环、返回分支和关键调用。
节点标签优先使用简洁自然语言。
`.trim()
  }
}
