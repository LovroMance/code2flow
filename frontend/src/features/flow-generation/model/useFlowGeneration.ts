import { computed, ref } from 'vue'
import type { SupportedLanguage } from '../../../entities/flow/model/types'
import { streamMultiFlow } from '../../../shared/api/multifile.api'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'
import type { MultiFileResult } from '../../../entities/flow/model/multifile'
import { getErrorMessage } from '../../../shared/lib/errorMessage'

export function useFlowGeneration() {
  const status = ref<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const errorMessage = ref('')
  const detectedLanguage = ref<SupportedLanguage>('unknown')
  const multiResult = ref<MultiFileResult | null>(null)
  const mermaid = computed(() => multiResult.value?.mermaid ?? '')
  const mappings = computed(() => multiResult.value?.mappings ?? [])
  const progressText = ref('')
  let abortController: AbortController | undefined

  const isLoading = computed(() => status.value === 'streaming')

  function resetOutput() {
    status.value = 'idle'
    errorMessage.value = ''
    multiResult.value = null
    progressText.value = ''
  }

  function setDetectedLanguage(language: SupportedLanguage) {
    detectedLanguage.value = language
  }

  async function acceptOutput(result: MultiFileResult) {
    if (result.hasExecutableFlow && result.mermaid !== multiResult.value?.mermaid)
      await ensureMermaid().parse(result.mermaid)
    detectedLanguage.value = result.detectedLanguage
    multiResult.value = result
  }

  async function restoreMultiOutput(result: MultiFileResult | null, failed = false) {
    resetOutput()
    if (!result) {
      if (failed) failRendering('上次分析失败，请重新生成流程图。')
      return
    }
    try {
      await acceptOutput(result)
      status.value = 'done'
    } catch (error) {
      failRendering(getErrorMessage(error, '流程图解析失败。'))
    }
  }
  function failRendering(reason: string) {
    status.value = 'error'
    multiResult.value = null
    errorMessage.value = reason
  }
  /** 管理多文件流式状态与取消；结果通过契约校验和 Mermaid 解析后才交给页面。 */
  async function generateMultiFlow(threadId: string, snapshotId: string, onChunksReady: () => void) {
    resetOutput()
    status.value = 'streaming'
    abortController = new AbortController()
    let incomplete = ''
    try {
      const result = await streamMultiFlow(
        threadId,
        snapshotId,
        abortController.signal,
        (metadata) => {
          if (metadata.stage === 'chunks-ready') onChunksReady()
          const stages: Record<string, string> = {
            prepare: '准备快照',
            detect: '识别语言',
            basic: '建立检索',
            'chunks-ready': '源码切块完成',
            index: '分析全部文件',
            generate: '生成局部流程',
            'detail-ready': '细分图已就绪',
            overview: '汇总总体图',
            complete: '流程图已就绪',
            resolve: '查找引用候选',
            incomplete: '分析未完成'
          }
          progressText.value = `${stages[String(metadata.stage)] ?? '处理中'} ${metadata.completed ?? ''}${metadata.total ? `/${metadata.total}` : ''}`
          if (Array.isArray(metadata.missingRanges))
            incomplete = metadata.missingRanges
              .map((value) => {
                if (
                  !value ||
                  typeof value !== 'object' ||
                  !('path' in value) ||
                  !('lineStart' in value) ||
                  !('lineEnd' in value)
                )
                  return ''
                return `${String(value.path)} 第 ${String(value.lineStart)}–${String(value.lineEnd)} 行`
              })
              .filter(Boolean)
              .join('\n')
        },
        acceptOutput
      )
      await acceptOutput(result)
      status.value = 'done'
    } catch (error) {
      if (multiResult.value) {
        multiResult.value = {
          ...multiResult.value,
          overview: { status: 'unavailable', message: '总体图生成未完成，可以查看已生成的细分图。' }
        }
        status.value = 'done'
        return
      }
      failRendering(
        `${getErrorMessage(error, '生成失败。')}${incomplete ? `\n未完成的源码行范围：\n${incomplete}` : ''}`
      )
    } finally {
      abortController = undefined
    }
  }

  return {
    multiResult,
    progressText,
    generateMultiFlow,
    restoreMultiOutput,
    failRendering,
    cancelGeneration: () => abortController?.abort(),
    errorMessage,
    detectedLanguage,
    isLoading,
    mappings,
    mermaid,
    resetOutput,
    setDetectedLanguage,
    status
  }
}
