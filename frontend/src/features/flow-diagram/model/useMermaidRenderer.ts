import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { NodeMapping } from '../../../entities/flow/model/types'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'
import { buildInteractiveMermaid } from './buildInteractiveMermaid'

declare global {
  interface Window {
    code2flowNodeClick?: (nodeId: string) => void
  }
}

let renderSequence = 0

// 流式更新合并后串行渲染，在屏幕外测量，成功后才替换当前图，避免挤压页面和闪空。
export function useMermaidRenderer(
  mermaidSource: () => string,
  mappings: () => NodeMapping[],
  onSelectNode: (nodeId: string) => void,
  isStreaming: () => boolean = () => false
) {
  const diagramElement = ref<HTMLElement | null>(null)
  const renderedSvg = shallowRef<SVGSVGElement | null>(null)
  const renderError = ref('')
  const isRendering = ref(false)
  let revision = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false

  function scheduleRender() {
    revision += 1
    pending = true
    if (!isStreaming() && timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (isRendering.value || timer || disposed) return
    // 定期提交最新快照，而不是每个 token 都重新计算布局。
    timer = setTimeout(
      () => {
        timer = undefined
        void renderDiagram()
      },
      isStreaming() ? 450 : 0
    )
  }

  async function renderDiagram() {
    if (!diagramElement.value || disposed) return
    const currentRevision = revision
    const source = mermaidSource()
    const currentMappings = mappings()
    pending = false
    isRendering.value = true

    const scratch = document.createElement('div')
    scratch.setAttribute('aria-hidden', 'true')
    scratch.style.cssText =
      'position:fixed;left:-100000px;top:0;width:10000px;visibility:hidden;pointer-events:none;'
    document.body.append(scratch)

    try {
      window.code2flowNodeClick = onSelectNode
      const { svg, bindFunctions } = await ensureMermaid().render(
        `code2flow-mermaid-${renderSequence++}`,
        buildInteractiveMermaid(source, currentMappings),
        scratch
      )
      if (disposed || !diagramElement.value || currentRevision !== revision) return

      diagramElement.value.innerHTML = svg
      const element = diagramElement.value.querySelector('svg')
      if (element instanceof SVGSVGElement) {
        const { width, height } = element.viewBox.baseVal
        element.style.width = `${width}px`
        element.style.height = `${height}px`
        element.style.maxWidth = 'none'
        renderedSvg.value = element
      }
      bindFunctions?.(diagramElement.value)
      renderError.value = ''
    } catch {
      // 不完整的流式片段保留上一张有效图；最终失败仍明确显示错误。
      if (!disposed && currentRevision === revision && !isStreaming()) {
        renderError.value = '流程图渲染失败，请重新生成。'
      }
    } finally {
      scratch.remove()
      isRendering.value = false
      if (pending && !disposed) scheduleRender()
    }
  }

  watch([mermaidSource, mappings, isStreaming], scheduleRender, { flush: 'post' })
  onMounted(() => void nextTick(scheduleRender))
  onBeforeUnmount(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    if (window.code2flowNodeClick === onSelectNode) delete window.code2flowNodeClick
  })

  return { diagramElement, renderedSvg, renderError, isRendering }
}
