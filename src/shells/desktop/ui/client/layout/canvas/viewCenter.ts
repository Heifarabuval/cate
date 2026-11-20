import type { Point, Size } from '@workspace/canvas/contract'

/** The canvas point under the middle of the container (the inverse of the
 *  store's `centerOn`: screen = canvas * zoom + offset). */
export function viewCenterOf(view: { containerSize: Size; viewportOffset: Point; zoomLevel: number }): Point {
  return {
    x: (view.containerSize.width / 2 - view.viewportOffset.x) / view.zoomLevel,
    y: (view.containerSize.height / 2 - view.viewportOffset.y) / view.zoomLevel
  }
}
