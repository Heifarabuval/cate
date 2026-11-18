// Frames of a canvas, drawn under the nodes: each rect is `frameBounds` of its
// members' rects as this client shows them (gesture preview included), so a
// frame follows a node dragged on its own. No rule lives here: geometry comes
// from `workspace/canvas/contract/frame.ts`, membership from the document.

import React, { useMemo } from 'react'
import { FRAME_TITLE_HEIGHT, frameBounds, type Rect } from '@workspace/canvas/contract'
import { dockPanels, type CanvasFrame, type CanvasNode, type NodeId } from '@workspace/document/contract'
import { documentStoreFor } from '@client/document'
import { useDocument } from '../../../document'
import { setCollapsedChange } from './frameChanges'
import { useCanvasView } from '../context'
import { NODE_CORNER_RADIUS } from '../constants'
import { FrameTitleBar } from './FrameTitleBar'

// Under every node (their z-index is 1000 + order), over the grid.
const FRAME_Z = 500

interface FrameViewProps {
  workspaceId: string
  canvasId: string
  frame: CanvasFrame
  nodes: Record<NodeId, CanvasNode>
}

function FrameView({ workspaceId, canvasId, frame, nodes }: FrameViewProps): React.ReactElement {
  const members = useMemo(() => Object.values(nodes).filter((n) => n.frameId === frame.id), [nodes, frame.id])
  const shown = useCanvasView((s) => s.nodes)
  const rects = members.flatMap((n) => (shown[n.id] ? [shown[n.id].rect] : []))
  const bounds: Rect = frameBounds(rects, frame.at, frame.collapsed)
  const panelCount = members.reduce((sum, n) => sum + dockPanels(n.dock).length, 0)
  const done = frame.state === 'done'
  const toggle = () => {
    const store = documentStoreFor(workspaceId)
    const canvas = store?.getSnapshot().canvases[canvasId]
    const change = canvas && setCollapsedChange(canvas, frame.id, !frame.collapsed)
    if (change) store?.propose(change)
  }
  return (
    <div
      data-frame={frame.id}
      data-dim={done ? 'true' : undefined}
      className={`${done ? 'border-subtle' : 'border-strong'} border transition-[left,top,width,height] duration-150 motion-reduce:transition-none`}
      style={{
        position: 'absolute',
        left: bounds.origin.x,
        top: bounds.origin.y,
        width: bounds.size.width,
        height: bounds.size.height,
        zIndex: FRAME_Z,
        borderRadius: NODE_CORNER_RADIUS,
        pointerEvents: 'none',
        // Dim the outline and bar fill, never the text: the label keeps its contrast.
        background: done ? 'transparent' : 'var(--surface-hover)'
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: FRAME_TITLE_HEIGHT }}>
        <FrameTitleBar title={frame.title} state={frame.state} panelCount={panelCount} onToggleCollapse={toggle} />
      </div>
    </div>
  )
}

export function FrameLayer({ workspaceId, canvasId }: { workspaceId: string; canvasId: string }): React.ReactElement | null {
  const frames = useDocument(workspaceId, (d) => d.canvases[canvasId]?.frames)
  const nodes = useDocument(workspaceId, (d) => d.canvases[canvasId]?.nodes)
  if (!frames || !nodes) return null
  return (
    <>
      {Object.values(frames).map((frame) => (
        <FrameView key={frame.id} workspaceId={workspaceId} canvasId={canvasId} frame={frame} nodes={nodes} />
      ))}
    </>
  )
}
