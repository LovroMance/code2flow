import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NodeMapping } from '../../../entities/flow/model/types'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'
import { buildInteractiveMermaid } from './buildInteractiveMermaid'

declare global {
  interface Window {
    code2flowNodeClick?: (nodeId: string) => void
  }
}

let renderSequence = 0

export function useMermaidRenderer(
  mermaidSource: () => string,
  mappings: () => NodeMapping[],
  onSelectNode: (nodeId: string) => void
) {
  const diagramElement = ref<HTMLElement | null>(null)
  const renderError = ref('')

  async function renderDiagram() {
    if (!diagramElement.value) {
      return
    }

    const mermaid = ensureMermaid()
    const baseSource = mermaidSource()
    const currentMappings = mappings()

    renderError.value = ''
    window.code2flowNodeClick = onSelectNode

    try {
      const id = `code2flow-mermaid-${renderSequence++}`
      const { svg, bindFunctions } = await mermaid.render(
        id,
        buildInteractiveMermaid(baseSource, currentMappings)
      )

      if (!diagramElement.value) {
        return
      }

      diagramElement.value.innerHTML = svg
      const svgElement = diagramElement.value.querySelector('svg')

      if (svgElement instanceof SVGSVGElement) {
        const viewBoxWidth = svgElement.viewBox.baseVal.width
        const viewBoxHeight = svgElement.viewBox.baseVal.height

        svgElement.removeAttribute('width')

        if (viewBoxWidth > 0) {
          svgElement.style.width = `${viewBoxWidth}px`
        }

        if (viewBoxHeight > 0) {
          svgElement.style.height = `${viewBoxHeight}px`
        } else {
          svgElement.style.height = 'auto'
        }
      }

      bindFunctions?.(diagramElement.value)
    } catch (error) {
      renderError.value = error instanceof Error ? error.message : 'Mermaid 渲染失败'

      if (diagramElement.value) {
        diagramElement.value.innerHTML = ''
      }
    }
  }

  watch(
    [mermaidSource, mappings],
    () => {
      void nextTick(() => renderDiagram())
    },
    { immediate: true, flush: 'post' }
  )

  onMounted(() => {
    void nextTick(() => renderDiagram())
  })

  onBeforeUnmount(() => {
    if (window.code2flowNodeClick === onSelectNode) {
      delete window.code2flowNodeClick
    }
  })

  return {
    diagramElement,
    renderError
  }
}
