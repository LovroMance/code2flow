import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { fitDiagram, zoomAt, type DiagramCamera } from './viewportGeometry'

interface OverviewNode {
  x: number
  y: number
  width: number
  height: number
}
interface OverviewEdge {
  path: string
  transform: string
}

// 相机不依赖 SVG 的 CSS 布局；缩放、拖动、小地图共享同一世界坐标。
export function useDiagramViewport(
  svg: ShallowRef<SVGSVGElement | null>,
  isStreaming: () => boolean
) {
  const viewportElement = ref<HTMLElement | null>(null)
  const camera = ref<DiagramCamera>({ scale: 1, x: 24, y: 24 })
  const size = ref({ width: 1, height: 1 })
  const viewport = ref({ width: 1, height: 1 })
  const overviewNodes = shallowRef<OverviewNode[]>([])
  const overviewEdges = shallowRef<OverviewEdge[]>([])
  const isDragging = ref(false)
  const isOverviewDragging = ref(false)
  const mode = ref<'fit' | 'read' | 'manual'>('fit')
  let observer: ResizeObserver | undefined
  let previousAnchor: OverviewNode | undefined
  let dragStart = { x: 0, y: 0, cameraX: 0, cameraY: 0 }
  let overviewDrag:
    | {
        pointerId: number
        point: DOMPoint
        camera: DiagramCamera
        clientX: number
        clientY: number
        moved: boolean
      }
    | undefined

  function fitView() {
    mode.value = 'fit'
    camera.value = fitDiagram(
      size.value.width,
      size.value.height,
      viewport.value.width,
      viewport.value.height
    )
  }

  function readView() {
    mode.value = 'read'
    camera.value = zoomAt(camera.value, 1, viewport.value.width / 2, viewport.value.height / 2)
  }

  function changeZoom(scale: number, x = viewport.value.width / 2, y = viewport.value.height / 2) {
    mode.value = 'manual'
    camera.value = zoomAt(camera.value, Math.min(3, Math.max(0.05, scale)), x, y)
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const bounds = viewportElement.value?.getBoundingClientRect()
    if (!bounds) return
    changeZoom(
      camera.value.scale * Math.exp(-event.deltaY * 0.0015),
      event.clientX - bounds.left,
      event.clientY - bounds.top
    )
  }

  function handleKeydown(event: KeyboardEvent) {
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [64, 0],
      ArrowRight: [-64, 0],
      ArrowUp: [0, 64],
      ArrowDown: [0, -64]
    }
    const delta = movement[event.key]
    if (delta) {
      event.preventDefault()
      mode.value = 'manual'
      camera.value = { ...camera.value, x: camera.value.x + delta[0], y: camera.value.y + delta[1] }
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      changeZoom(camera.value.scale * 1.2)
    } else if (event.key === '-') {
      event.preventDefault()
      changeZoom(camera.value.scale / 1.2)
    } else if (event.key === 'Home') {
      event.preventDefault()
      fitView()
    }
  }

  function handlePointerDown(event: PointerEvent) {
    const target = event.target instanceof Element ? event.target : null
    if (event.button !== 0 || target?.closest('.node, .edgeLabel, button')) return
    mode.value = 'manual'
    isDragging.value = true
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      cameraX: camera.value.x,
      cameraY: camera.value.y
    }
    viewportElement.value?.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging.value) return
    camera.value = {
      ...camera.value,
      x: dragStart.cameraX + event.clientX - dragStart.x,
      y: dragStart.cameraY + event.clientY - dragStart.y
    }
  }

  function stopDragging(event: PointerEvent) {
    isDragging.value = false
    if (viewportElement.value?.hasPointerCapture(event.pointerId))
      viewportElement.value.releasePointerCapture(event.pointerId)
  }

  function navigateOverview(event: MouseEvent) {
    const element = event.currentTarget
    if (!(element instanceof SVGSVGElement)) return
    const matrix = element.getScreenCTM()
    if (!matrix) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    mode.value = 'manual'
    camera.value = {
      ...camera.value,
      x: viewport.value.width / 2 - point.x * camera.value.scale,
      y: viewport.value.height / 2 - point.y * camera.value.scale
    }
  }

  // 在小地图中拖动视口框时保留抓取位置，拖动空白处则先将该处移到主图中心。
  function handleOverviewPointerDown(event: PointerEvent) {
    const element = event.currentTarget
    if (event.button !== 0 || overviewDrag || !(element instanceof SVGSVGElement)) return
    const matrix = element.getScreenCTM()
    if (!matrix) return
    event.preventDefault()
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const target = event.target instanceof Element ? event.target : null
    if (!target?.closest('.diagram-overview-region')) navigateOverview(event)
    mode.value = 'manual'
    overviewDrag = {
      pointerId: event.pointerId,
      point,
      camera: { ...camera.value },
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false
    }
    isOverviewDragging.value = true
    element.setPointerCapture(event.pointerId)
  }

  function handleOverviewPointerMove(event: PointerEvent) {
    const element = event.currentTarget
    if (
      !overviewDrag ||
      overviewDrag.pointerId !== event.pointerId ||
      !(element instanceof SVGSVGElement)
    )
      return
    const matrix = element.getScreenCTM()
    if (!matrix) return
    if (
      !overviewDrag.moved &&
      Math.hypot(event.clientX - overviewDrag.clientX, event.clientY - overviewDrag.clientY) < 3
    )
      return
    overviewDrag.moved = true
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const scale = overviewDrag.camera.scale
    const clampOffset = (offset: number, extent: number, visible: number) => {
      const scaledExtent = extent * scale
      return scaledExtent <= visible
        ? (visible - scaledExtent) / 2
        : Math.min(0, Math.max(visible - scaledExtent, offset))
    }
    camera.value = {
      ...overviewDrag.camera,
      x: clampOffset(
        overviewDrag.camera.x - (point.x - overviewDrag.point.x) * overviewDrag.camera.scale,
        size.value.width,
        viewport.value.width
      ),
      y: clampOffset(
        overviewDrag.camera.y - (point.y - overviewDrag.point.y) * overviewDrag.camera.scale,
        size.value.height,
        viewport.value.height
      )
    }
  }

  function stopOverviewDragging(event: PointerEvent) {
    if (!overviewDrag || overviewDrag.pointerId !== event.pointerId) return
    const moved = overviewDrag.moved
    overviewDrag = undefined
    isOverviewDragging.value = false
    const element = event.currentTarget
    if (element instanceof SVGSVGElement && element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId)
    // 拖动结束不再触发居中跳转；取消手势也不执行点击操作。
    if (event.type === 'pointerup' && !moved) navigateOverview(event)
  }

  function readSvg(element: SVGSVGElement) {
    const box = element.viewBox.baseVal
    size.value = { width: box.width, height: box.height }
    const bounds = element.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const nodes = Array.from(element.querySelectorAll<SVGGraphicsElement>('.node')).map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        x: ((rect.left - bounds.left) / bounds.width) * box.width,
        y: ((rect.top - bounds.top) / bounds.height) * box.height,
        width: (rect.width / bounds.width) * box.width,
        height: (rect.height / bounds.height) * box.height
      }
    })
    overviewNodes.value = nodes
    const rootMatrix = element.getScreenCTM()
    overviewEdges.value = Array.from(
      element.querySelectorAll<SVGPathElement>('.flowchart-link')
    ).map((path) => {
      const matrix = path.getScreenCTM()
      const relative =
        rootMatrix && matrix
          ? new DOMMatrix()
              .translate(-box.x, -box.y)
              .multiply(rootMatrix.inverse())
              .multiply(matrix)
          : new DOMMatrix()
      return { path: path.getAttribute('d') ?? '', transform: relative.toString() }
    })

    if (mode.value === 'fit' && !isStreaming()) fitView()
    else if (previousAnchor && nodes[0]) {
      // 新分支会改变 Mermaid 的整体宽度，以首节点为锚点抵消重新居中的位移。
      camera.value = {
        ...camera.value,
        x: camera.value.x + (previousAnchor.x - nodes[0].x) * camera.value.scale,
        y: camera.value.y + (previousAnchor.y - nodes[0].y) * camera.value.scale
      }
    } else {
      camera.value = {
        scale: 1,
        x: nodes[0] ? viewport.value.width / 2 - (nodes[0].x + nodes[0].width / 2) : 24,
        y: 24
      }
    }
    previousAnchor = nodes[0]
  }

  watch(
    svg,
    (element) => {
      if (element) readSvg(element)
    },
    { flush: 'post' }
  )
  watch(isStreaming, (streaming) => {
    if (streaming) {
      previousAnchor = undefined
      mode.value = 'read'
    }
  })

  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const previous = viewport.value
      viewport.value = { width: entry.contentRect.width, height: entry.contentRect.height }
      if (mode.value === 'fit') fitView()
      else
        camera.value = {
          ...camera.value,
          x: camera.value.x + (viewport.value.width - previous.width) / 2,
          y: camera.value.y + (viewport.value.height - previous.height) / 2
        }
    })
    if (viewportElement.value) observer.observe(viewportElement.value)
  })
  onBeforeUnmount(() => observer?.disconnect())

  const overviewViewBox = computed(() => `0 0 ${size.value.width} ${size.value.height}`)
  const visibleRegion = computed(() => {
    const { scale, x, y } = camera.value
    const left = Math.min(size.value.width, Math.max(0, -x / scale))
    const top = Math.min(size.value.height, Math.max(0, -y / scale))
    return {
      x: left,
      y: top,
      width: Math.max(0, Math.min(size.value.width, (viewport.value.width - x) / scale) - left),
      height: Math.max(0, Math.min(size.value.height, (viewport.value.height - y) / scale) - top)
    }
  })

  return {
    viewportElement,
    camera,
    isDragging,
    isOverviewDragging,
    overviewNodes,
    overviewEdges,
    overviewViewBox,
    visibleRegion,
    fitView,
    readView,
    changeZoom,
    handleWheel,
    handleKeydown,
    handlePointerDown,
    handlePointerMove,
    stopDragging,
    handleOverviewPointerDown,
    handleOverviewPointerMove,
    stopOverviewDragging
  }
}
