import { describe, expect, it } from 'vitest'
import { fitDiagram, zoomAt } from '../src/features/flow-diagram/model/viewportGeometry'

describe('流程图视口几何', () => {
  it('完整容纳大图，保留边距并居中', () => {
    const camera = fitDiagram(1600, 2400, 800, 600)
    expect(camera.x).toBeGreaterThanOrEqual(32)
    expect(camera.y).toBeGreaterThanOrEqual(32)
    expect(camera.x * 2 + 1600 * camera.scale).toBeCloseTo(800)
    expect(camera.y * 2 + 2400 * camera.scale).toBeCloseTo(600)
  })

  it('小图保持原始字号，不自动放大', () => {
    expect(fitDiagram(200, 100, 800, 600)).toEqual({ scale: 1, x: 300, y: 250 })
  })

  it('超大图可缩至 45% 以下，完整全览不受旧缩放下限限制', () => {
    const camera = fitDiagram(1000, 10000, 800, 600)
    expect(camera.scale).toBeLessThan(0.45)
    expect(10000 * camera.scale).toBeLessThanOrEqual(536)
  })

  it('缩放后指针下面仍然是同一处图形坐标', () => {
    const before = { scale: 0.5, x: -120, y: 80 }
    const after = zoomAt(before, 1.2, 350, 230)
    expect((350 - after.x) / after.scale).toBeCloseTo((350 - before.x) / before.scale)
    expect((230 - after.y) / after.scale).toBeCloseTo((230 - before.y) / before.scale)
  })

  it('画布尚未获得尺寸时不会产生无穷大或无效坐标', () => {
    const camera = fitDiagram(0, 0, 0, 0)
    expect(Object.values(camera).every(Number.isFinite)).toBe(true)
    expect(camera.scale).toBeGreaterThan(0)
  })
})
