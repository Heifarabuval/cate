// A canvas as a panel view: the surface, its nodes (viewport-culled and
// staged across frames on a cold mount), relation drawing and the toolbar.

import React, { useCallback, useEffect, useMemo } from 'react'
import { clientStateFor } from '@client/document'
import { useClientState, useDocument } from '../../document'
import type { NodeId } from '@workspace/document/contract'
import { CANVAS_REVEAL_INTENT } from '@client/host'
import { useKeepMountedPanelIds } from '../../host/hooks'
import { canvasViewFor } from './registry'
import { focusedNodeId } from './selection'
import { CanvasViewProvider, useCanvasView } from './context'
import { installCanvasTargetPicker } from './targetPicker'
import { collapsedNodeIds, useStagedVisibleNodeIds, useVisibleNodeIds } from './visibleNodes'
import Canvas from './Canvas'
import CanvasNode from './CanvasNode'
import CanvasToolbar from './CanvasToolbar'
import { NodeErrorBoundary } from './NodeErrorBoundary'
import { PanelConnectionLayer } from './PanelConnectionLayer'
import { FrameLayer } from './frame/FrameLayer'

export interface CanvasViewProps {
  workspaceId: string
  canvasId: string
  /** The canvas panel showing this canvas. */
  canvasPanelId: string
}

const sameIds = (a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>) => a.size === b.size && [...a].every((id) => b.has(id))

interface NodeSlotProps {
  workspaceId: string
  canvasId: string
  canvasPanelId: string
  nodeId: NodeId
  isHidden: boolean
}

// Reads its own focus flag so a focus change re-renders two nodes, not all.
const NodeSlot = React.memo(function NodeSlot({ workspaceId, canvasId, canvasPanelId, nodeId, isHidden }: NodeSlotProps) {
  const exists = useCanvasView((s) => !!s.nodes[nodeId])
  const isFocused = useCanvasView((s) => focusedNodeId(s) === nodeId)
  if (!exists) return null
  return (
    <NodeErrorBoundary nodeId={nodeId}>
      <CanvasNode workspaceId={workspaceId} canvasId={canvasId} canvasPanelId={canvasPanelId} nodeId={nodeId} isFocused={isFocused} isHidden={isHidden} />
    </NodeErrorBoundary>
  )
})

function CanvasNodes({ workspaceId, canvasId, canvasPanelId, store }: CanvasViewProps & {
  store: NonNullable<ReturnType<typeof canvasViewFor>>
}) {
  const keepMounted = useKeepMountedPanelIds(workspaceId)
  // Same members, same set: a rect op on the canvas does not re-run the cull.
  const hidden = useDocument(workspaceId, (d) => collapsedNodeIds(d.canvases[canvasId]), sameIds)
  const visible = useVisibleNodeIds(store, keepMounted, hidden)
  const staged = useStagedVisibleNodeIds(visible)
  return (
    <>
      <FrameLayer workspaceId={workspaceId} canvasId={canvasId} />
      <PanelConnectionLayer workspaceId={workspaceId} />
      {staged.map((nodeId) => (
        <NodeSlot key={nodeId} workspaceId={workspaceId} canvasId={canvasId} canvasPanelId={canvasPanelId} nodeId={nodeId} isHidden={hidden.has(nodeId)} />
      ))}
    </>
  )
}

export function CanvasView({ workspaceId, canvasId, canvasPanelId }: CanvasViewProps): React.ReactElement | null {
  const exists = useDocument(workspaceId, (d) => !!d.canvases[canvasId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => (exists ? canvasViewFor(workspaceId, canvasId) : null), [workspaceId, canvasId, exists])

  // The canvas is the focused panel until a press inside a node (which runs
  // later, on mousedown) points focus at that node's panel.
  useEffect(installCanvasTargetPicker, [])

  // A reveal (palette, `cate`, notifications) leaves an intent on this canvas
  // panel: centre and focus the node it names.
  const intents = useClientState(workspaceId, (s) => s.intents)
  useEffect(() => {
    if (!store || !intents.some((i) => i.panelId === canvasPanelId && i.kind === CANVAS_REVEAL_INTENT)) return
    const taken = clientStateFor(workspaceId)?.takeIntents(canvasPanelId) ?? []
    const reveal = taken.filter((i) => i.kind === CANVAS_REVEAL_INTENT).at(-1)
    const nodeId = (reveal?.data as { nodeId?: string } | undefined)?.nodeId
    if (nodeId) store.getState().focusAndCenter(nodeId)
  }, [intents, store, workspaceId, canvasPanelId])

  const handlePointerDown = useCallback(() => {
    clientStateFor(workspaceId)?.focus(canvasPanelId)
  }, [workspaceId, canvasPanelId])

  if (!store) return null
  return (
    <CanvasViewProvider store={store}>
      {/* `isolate` keeps the toolbar's z-50 inside this panel, behind the
          sidebars, even when it overflows its inset box. */}
      <div data-canvas-area className="relative w-full h-full isolate" onPointerDown={handlePointerDown}>
        <Canvas
          workspaceId={workspaceId}
          canvasId={canvasId}
          canvasPanelId={canvasPanelId}
          overlayChildren={<CanvasToolbar workspaceId={workspaceId} canvasId={canvasId} canvasPanelId={canvasPanelId} />}
        >
          <CanvasNodes workspaceId={workspaceId} canvasId={canvasId} canvasPanelId={canvasPanelId} store={store} />
        </Canvas>
      </div>
    </CanvasViewProvider>
  )
}
