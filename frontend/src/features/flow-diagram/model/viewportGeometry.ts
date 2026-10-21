export interface DiagramCamera {
  scale: number
  x: number
  y: number
}

// 缩放围绕指定屏幕坐标，保证鼠标指向的节点不会跳到别处。
export function zoomAt(camera: DiagramCamera, scale: number, x: number, y: number): DiagramCamera {
  const ratio = scale / camera.scale
  return { scale, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio }
}

export function fitDiagram(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): DiagramCamera {
  const scale = Math.min(
    1,
    Math.max(1, viewportWidth - 64) / Math.max(1, width),
    Math.max(1, viewportHeight - 64) / Math.max(1, height)
  )
  return { scale, x: (viewportWidth - width * scale) / 2, y: (viewportHeight - height * scale) / 2 }
}
