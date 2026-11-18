import { describe, expect, it } from 'vitest'
import { CANVAS_GRID_SIZE, rect, rectsOverlap, type Rect } from './geometry'
import {
  FRAME_BAR_WIDTH,
  FRAME_COLUMNS,
  FRAME_PADDING,
  FRAME_TITLE_HEIGHT,
  frameBounds,
  frameOrigin,
  frameSlot,
} from './frame'

const AT = { x: 100, y: 200 }
const SIZE = { width: 400, height: 300 }

/** Adds `count` nodes one by one, the way `cate panel group add` does. */
function fill(count: number, at = AT, hand: Rect[] = []): Rect[] {
  const members: Rect[] = []
  for (let i = 0; i < count; i++) {
    const origin = frameSlot(members, [...members, ...hand], at, SIZE)
    members.push({ origin, size: SIZE })
  }
  return members
}

const noOverlap = (rects: Rect[]) =>
  rects.every((a, i) => rects.slice(i + 1).every((b) => !rectsOverlap(a, b)))

describe('frameBounds', () => {
  it('wraps the members with the padding and the title bar', () => {
    const bounds = frameBounds([rect(100, 200, 400, 300), rect(600, 250, 200, 100)], AT, false)
    expect(bounds).toEqual(
      rect(
        100 - FRAME_PADDING,
        200 - FRAME_PADDING - FRAME_TITLE_HEIGHT,
        700 + 2 * FRAME_PADDING,
        300 + 2 * FRAME_PADDING + FRAME_TITLE_HEIGHT,
      ),
    )
  })

  it('is the title bar alone at `at` when empty or collapsed', () => {
    const bar = rect(AT.x, AT.y, FRAME_BAR_WIDTH, FRAME_TITLE_HEIGHT)
    expect(frameBounds([], AT, false)).toEqual(bar)
    expect(frameBounds([rect(0, 0, 50, 50)], AT, true)).toEqual(bar)
  })
})

describe('frameOrigin', () => {
  it('is the top left corner of the title bar of the members', () => {
    const members = [rect(100, 200, 400, 300), rect(600, 250, 200, 100)]
    expect(frameOrigin(members)).toEqual(frameBounds(members, AT, false).origin)
  })

  it('is null without members', () => {
    expect(frameOrigin([])).toBeNull()
  })
})

describe('frameSlot', () => {
  it('puts the first node inside an empty frame, under its title bar, on the grid', () => {
    const origin = frameSlot([], [], AT, SIZE)
    expect(origin).toEqual({ x: AT.x + FRAME_PADDING, y: AT.y + FRAME_TITLE_HEIGHT + FRAME_PADDING })
    expect(origin.x % CANVAS_GRID_SIZE).toBe(0)
    expect(origin.y % CANVAS_GRID_SIZE).toBe(0)
  })

  it('places 16 nodes without overlap, a row of 4 at a time', () => {
    const members = fill(16)
    expect(noOverlap(members)).toBe(true)
    expect(new Set(members.map((m) => m.origin.y)).size).toBe(16 / FRAME_COLUMNS)
    expect(members.slice(0, FRAME_COLUMNS).every((m) => m.origin.y === members[0].origin.y)).toBe(true)
    expect(members[FRAME_COLUMNS].origin.x).toBe(members[0].origin.x)
    expect(members.every((m) => m.origin.x % CANVAS_GRID_SIZE === 0 && m.origin.y % CANVAS_GRID_SIZE === 0)).toBe(true)
  })

  it('leaves hand placed nodes where they are and goes around them', () => {
    const first = fill(1)[0]
    const hand = rect(first.origin.x + SIZE.width + 20, first.origin.y, 100, 100)
    const members = fill(6, AT, [hand])
    expect(members.every((m) => !rectsOverlap(m, hand))).toBe(true)
    expect(noOverlap(members)).toBe(true)
  })

  it('gives the same place whether the frame was filled in one go or late', () => {
    const all = fill(6)
    expect(frameSlot(all.slice(0, 5), all.slice(0, 5), AT, SIZE)).toEqual(all[5].origin)
    // `at` is ignored once there are members: the grid stays where the first one sits.
    expect(frameSlot(all.slice(0, 5), all.slice(0, 5), { x: 9000, y: 9000 }, SIZE)).toEqual(all[5].origin)
  })

  it('skips a place held by a node of the canvas that is not a member', () => {
    const members = fill(1)
    const other = rect(members[0].origin.x + SIZE.width, members[0].origin.y, 40, 40)
    const origin = frameSlot(members, [...members, other], AT, SIZE)
    expect(rectsOverlap({ origin, size: SIZE }, other)).toBe(false)
  })
})
