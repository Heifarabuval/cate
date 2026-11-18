// Frame geometry. A frame has no stored size: its rect comes from the rects of
// its member nodes, and a frame without a visible member sits at its anchor
// `at`. Pure, takes rects and no document.

import {
  CANVAS_GRID_SIZE,
  boundingRect,
  inflateRect,
  rect,
  rectsOverlap,
  snapScalar,
  snapToGrid,
  type Point,
  type Rect,
  type Size,
} from './geometry'

/** Space between the members and the border of the frame. */
export const FRAME_PADDING = CANVAS_GRID_SIZE
/** Height of the title bar, on top of the padding. */
export const FRAME_TITLE_HEIGHT = 2 * CANVAS_GRID_SIZE
/** Width of the title bar of a frame that has no rect to derive (empty or collapsed). */
export const FRAME_BAR_WIDTH = 14 * CANVAS_GRID_SIZE
/** Nodes per row of the frame's grid. */
export const FRAME_COLUMNS = 4

/** The rect of a frame: the members' bounding rect grown by the padding and
 *  topped by the title bar; the bar alone at `at` when empty or collapsed. */
export function frameBounds(memberRects: readonly Rect[], at: Point, collapsed: boolean): Rect {
  const members = boundingRect(memberRects)
  if (!members || collapsed) return rect(at.x, at.y, FRAME_BAR_WIDTH, FRAME_TITLE_HEIGHT)
  const padded = inflateRect(members, FRAME_PADDING)
  return rect(
    padded.origin.x,
    padded.origin.y - FRAME_TITLE_HEIGHT,
    padded.size.width,
    padded.size.height + FRAME_TITLE_HEIGHT,
  )
}

/** Top left corner of the title bar of the members' frame (the `at` to keep
 *  when the frame collapses or moves), or null without members. */
export function frameOrigin(memberRects: readonly Rect[]): Point | null {
  return memberRects.length === 0 ? null : frameBounds(memberRects, { x: 0, y: 0 }, false).origin
}

/**
 * The first free place for a node of `size` in a frame: cells of a grid of
 * `FRAME_COLUMNS` per row, row by row, that overlap none of `otherRects` (every
 * node of the canvas, members included) and whose grown frame overlaps none
 * of `otherFrames` (the bounds of the canvas's other frames, bars included).
 * The grid starts where the members start, or under the title bar at `at` for
 * an empty frame, so a collapsed, an empty and a late-filled frame give the
 * same cells. Nothing moves.
 *
 * ponytail: when another frame sits inside the span of the members, no cell
 * keeps the whole frame clear of it; a second pass then only keeps the new
 * node's own padded rect clear, so the search always ends.
 */
export function frameSlot(
  memberRects: readonly Rect[],
  otherRects: readonly Rect[],
  at: Point,
  size: Size,
  otherFrames: readonly Rect[] = [],
): Point {
  const members = boundingRect(memberRects)
  const anchor = snapToGrid(
    members ? members.origin : { x: at.x + FRAME_PADDING, y: at.y + FRAME_TITLE_HEIGHT + FRAME_PADDING },
  )
  const stepX = snapScalar(size.width + CANVAS_GRID_SIZE, CANVAS_GRID_SIZE, true)
  const stepY = snapScalar(size.height + CANVAS_GRID_SIZE, CANVAS_GRID_SIZE, true)
  const floor = Math.max(-Infinity, ...[...otherRects, ...otherFrames].map((r) => r.origin.y + r.size.height))
  for (const wholeFrame of [true, false]) {
    for (let row = 0; ; row++) {
      const y = anchor.y + row * stepY
      for (let column = 0; column < FRAME_COLUMNS; column++) {
        const origin = { x: anchor.x + column * stepX, y }
        const node = { origin, size }
        if (otherRects.some((r) => rectsOverlap(r, node))) continue
        const grown = frameBounds(wholeFrame ? [...memberRects, node] : [node], at, false)
        if (!otherFrames.some((r) => rectsOverlap(r, grown))) return origin
      }
      // Past this row even the padded node is below everything: nothing more to find.
      if (y - FRAME_PADDING - FRAME_TITLE_HEIGHT >= floor) break
    }
  }
  return anchor
}
