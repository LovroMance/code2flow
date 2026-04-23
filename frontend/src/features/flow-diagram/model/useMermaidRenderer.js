import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureMermaid } from '../../../shared/lib/mermaid/setup'
import { buildInteractiveMermaid } from './buildInteractiveMermaid'
let renderSequence = 0
export function useMermaidRenderer(mermaidSource, mappings, onSelectNode) {
  const diagramElement = ref(null)
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
