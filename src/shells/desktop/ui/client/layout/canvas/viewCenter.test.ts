import { expect, it } from 'vitest'
import { viewCenterOf } from './viewCenter'

it('is the canvas point under the middle of the container', () => {
  expect(viewCenterOf({ containerSize: { width: 1000, height: 600 }, viewportOffset: { x: 0, y: 0 }, zoomLevel: 1 })).toEqual({ x: 500, y: 300 })
})

it('follows the pan and the zoom: screen = canvas * zoom + offset', () => {
  const view = { containerSize: { width: 1000, height: 600 }, viewportOffset: { x: -200, y: 100 }, zoomLevel: 2 }
  const center = viewCenterOf(view)
  expect(center).toEqual({ x: 350, y: 100 })
  expect(center.x * view.zoomLevel + view.viewportOffset.x).toBe(500)
  expect(center.y * view.zoomLevel + view.viewportOffset.y).toBe(300)
})
