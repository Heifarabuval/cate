// Which frame a frame action acts on: the one under the pointer (its bar is
// hovered), else the frame of the selected node. Client state, never sent.

import type { CanvasModel, FrameId, NodeId } from '@workspace/document/contract'

interface Hovered {
  workspaceId: string
  canvasId: string
  frameId: FrameId
}

let hovered: Hovered | null = null

/** The bar of a frame gained (a frame) or lost (null) the pointer. */
export function setHoveredFrame(next: Hovered | null): void {
  hovered = next
}

/** The frame an action targets on this canvas, or null. `nodeId` is the
 *  canvas's focused or selected node. */
export function frameActionTarget(workspaceId: string, canvasId: string, canvas: CanvasModel | undefined, nodeId: NodeId | null): FrameId | null {
  const frames = canvas?.frames
  if (!frames) return null
  if (hovered?.workspaceId === workspaceId && hovered.canvasId === canvasId && Object.hasOwn(frames, hovered.frameId)) return hovered.frameId
  const frameId = nodeId ? canvas.nodes[nodeId]?.frameId : undefined
  return frameId !== undefined && Object.hasOwn(frames, frameId) ? frameId : null
}
