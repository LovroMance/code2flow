import { onBeforeUnmount, ref, watch } from 'vue'
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
      void renderDiagram()
    },
    { immediate: true }
  )

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
