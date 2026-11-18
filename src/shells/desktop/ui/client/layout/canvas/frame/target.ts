// Which frame a frame action acts on: the one under the pointer (its bar is
// hovered, client state), else the frame of the selected node.

import { clientStateFor } from '@client/document'
import type { CanvasModel, FrameId, NodeId } from '@workspace/document/contract'

/** The frame an action targets on this canvas, or null. `nodeId` is the
 *  canvas's focused or selected node. */
export function frameActionTarget(workspaceId: string, canvasId: string, canvas: CanvasModel | undefined, nodeId: NodeId | null): FrameId | null {
  const frames = canvas?.frames
  if (!frames) return null
  const hovered = clientStateFor(workspaceId)?.getSnapshot().hoveredFrame
  if (hovered?.canvasId === canvasId && Object.hasOwn(frames, hovered.frameId)) return hovered.frameId
  const frameId = nodeId ? canvas.nodes[nodeId]?.frameId : undefined
  return frameId !== undefined && Object.hasOwn(frames, frameId) ? frameId : null
}
