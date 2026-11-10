import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { NodeMapping } from '../../../entities/flow/model/types'
import { getErrorMessage } from '../../../shared/lib/errorMessage'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'

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
      const mermaid = ensureMermaid()
      const maxTextSize = mermaid.mermaidAPI.getConfig().maxTextSize
      if (maxTextSize !== undefined && source.length > maxTextSize)
        throw new Error(`流程图有 ${source.length} 个字符，超过渲染上限 ${maxTextSize}。`)
      const renderId = `code2flow-mermaid-${renderSequence++}`
      const { svg, bindFunctions } = await mermaid.render(renderId, source, scratch)
      if (disposed || !diagramElement.value || currentRevision !== revision) return

      diagramElement.value.innerHTML = svg
      const element = diagramElement.value.querySelector('svg')
      if (element instanceof SVGSVGElement) {
        const { width, height } = element.viewBox.baseVal
        element.style.width = `${width}px`
        element.style.height = `${height}px`
        element.style.maxWidth = 'none'
        // Mermaid 的输出可能移除 data-id，此时从带渲染前缀的 SVG ID 取回逻辑 ID。
        const mappedIds = new Set(currentMappings.map((mapping) => mapping.nodeId))
        const idPrefix = `${renderId}-flowchart-`
        for (const node of element.querySelectorAll<SVGGElement>('g.node')) {
          const nodeId =
            node.dataset.id ??
            (node.id.startsWith(idPrefix)
              ? node.id.slice(idPrefix.length).replace(/-\d+$/, '')
              : undefined)
          if (!nodeId || !mappedIds.has(nodeId)) continue
          node.classList.add('clickable')
          node.addEventListener('click', () => onSelectNode(nodeId))
        }
        renderedSvg.value = element
      }
      bindFunctions?.(diagramElement.value)
      renderError.value = ''
    } catch (error) {
      // 不完整的流式片段保留上一张有效图；最终失败仍明确显示错误。
      if (!disposed && currentRevision === revision && !isStreaming()) {
        renderError.value = getErrorMessage(error, '流程图渲染失败。')
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
  })

  return { diagramElement, renderedSvg, renderError, isRendering }
}
