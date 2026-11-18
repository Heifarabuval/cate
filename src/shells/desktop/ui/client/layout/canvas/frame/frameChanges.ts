// The document changes a frame gesture or action sends. Thin glue: the
// geometry is `workspace/canvas/contract/frame.ts`, the rules the reducer's.

import { frameOrigin } from '@workspace/canvas/contract'
import type { CanvasModel, DocChange, FrameId } from '@workspace/document/contract'

/** The rects of a frame's member nodes in the document. */
export function memberRects(canvas: CanvasModel, frameId: FrameId) {
  return Object.values(canvas.nodes).filter((n) => n.frameId === frameId).map((n) => n.rect)
}

/** Collapse or expand: one `updateFrame` that also anchors the bar where the
 *  members' frame starts, so the bar stays put and expanding puts it back.
 *  Null when the frame is gone. Never touches a panel. */
export function setCollapsedChange(canvas: CanvasModel, frameId: FrameId, collapsed: boolean): DocChange | null {
  const frame = canvas.frames?.[frameId]
  if (!frame) return null
  const at = frameOrigin(memberRects(canvas, frameId)) ?? frame.at
  return { kind: 'updateFrame', id: frameId, patch: { collapsed, at } }
}
