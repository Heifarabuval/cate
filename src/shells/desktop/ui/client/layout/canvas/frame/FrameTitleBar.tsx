// The title bar of a frame: title, state pill (icon and label, never colour
// alone), panel count, and the drag that moves the whole frame. The rules
// stay in `workspace/canvas/contract/frame.ts` and the reducer.

import React from 'react'
import { Hourglass, Layers, Loader, OctagonAlert, CircleCheck, type LucideIcon } from 'lucide-react'
import { frameOrigin, type Point } from '@workspace/canvas/contract'
import type { DocChange, FrameId, FrameState } from '@workspace/document/contract'
import { documentStoreFor } from '@client/document'
import { useCanvasViewStore } from '../context'
import { setHoveredFrame } from './target'

export const FRAME_STATE_VIEW: Record<FrameState, { label: string; Icon: LucideIcon; accent: string }> = {
  active: { label: 'en cours', Icon: Loader, accent: 'var(--focus-blue)' },
  waiting: { label: "t'attend", Icon: Hourglass, accent: 'var(--activity-orange)' },
  blocked: { label: 'bloqué', Icon: OctagonAlert, accent: 'var(--git-deleted)' },
  done: { label: 'fait', Icon: CircleCheck, accent: 'var(--activity-green)' }
}

/** Screen pixels a press must travel before it is a drag, not a click. */
const DRAG_SLOP = 3

export interface FrameTitleBarProps {
  workspaceId: string
  canvasId: string
  frameId: FrameId
  title: string
  state: FrameState
  panelCount: number
  /** Double click on the bar. */
  onToggleCollapse?: () => void
  /** The drag's offset in canvas units while it runs (null when it ends): a
   *  frame with no member rect to follow (empty, collapsed) moves by it. */
  onShift?: (shift: Point | null) => void
}

/** Drag of the bar: every member previews its move locally (the canvas view's
 *  gesture preview), then one batch carries the rects and the new anchor, so
 *  one undo puts everything back. */
function useBarDrag({ workspaceId, canvasId, frameId, onShift }: Pick<FrameTitleBarProps, 'workspaceId' | 'canvasId' | 'frameId' | 'onShift'>) {
  const view = useCanvasViewStore()
  return (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const documents = documentStoreFor(workspaceId)
    const canvas = documents?.getSnapshot().canvases[canvasId]
    const frame = canvas?.frames?.[frameId]
    if (!documents || !canvas || !frame) return
    const start = { x: event.clientX, y: event.clientY }
    const members = Object.values(canvas.nodes)
      .filter((n) => n.frameId === frameId && view.getState().nodes[n.id])
      .map((n) => ({ nodeId: n.id, origin: view.getState().nodes[n.id].origin, size: view.getState().nodes[n.id].size }))
    let delta: Point = { x: 0, y: 0 }
    let moved = false

    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_SLOP) return
      moved = true
      const zoom = view.getState().zoomLevel
      delta = { x: (e.clientX - start.x) / zoom, y: (e.clientY - start.y) / zoom }
      view.getState().previewRects(members.map((m) => ({ nodeId: m.nodeId, rect: { origin: { x: m.origin.x + delta.x, y: m.origin.y + delta.y }, size: m.size } })))
      onShift?.(delta)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      onShift?.(null)
      if (moved) {
        // A member closed mid-drag (CLI, another client) has no node left.
        const nodes = view.getState().nodes
        const rects = members.filter((m) => nodes[m.nodeId]).map((m) => ({ nodeId: m.nodeId, rect: nodes[m.nodeId].rect }))
        const at = frameOrigin(rects.map((r) => r.rect)) ?? { x: frame.at.x + delta.x, y: frame.at.y + delta.y }
        const changes: DocChange[] = [{ kind: 'updateFrame', id: frameId, patch: { at } }]
        if (rects.length > 0) changes.unshift({ kind: 'setNodeRects', canvasId, rects })
        documents.propose({ kind: 'batch', changes })
      }
      view.getState().clearPreview()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
}

export function FrameTitleBar({ workspaceId, canvasId, frameId, title, state, panelCount, onToggleCollapse, onShift }: FrameTitleBarProps): React.ReactElement {
  const { label, Icon, accent } = FRAME_STATE_VIEW[state]
  const onPointerDown = useBarDrag({ workspaceId, canvasId, frameId, onShift })
  return (
    <div
      data-frame-bar
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHoveredFrame({ workspaceId, canvasId, frameId })}
      onPointerLeave={() => setHoveredFrame(null)}
      onDoubleClick={onToggleCollapse}
      className="flex h-full w-full select-none items-center gap-2 px-2 text-xs"
      style={{ pointerEvents: 'auto', background: 'var(--surface-1)', borderRadius: 'inherit' }}
    >
      <span
        data-frame-state={state}
        className="inline-flex shrink-0 items-center gap-1 text-primary transition-colors motion-reduce:transition-none"
      >
        {/* The state's colour pulled toward the text colour keeps the icon at 3:1 in both themes. */}
        <Icon size={12} aria-hidden style={{ color: `color-mix(in srgb, ${accent} 45%, var(--text-primary))` }} />
        {label}
      </span>
      <span data-frame-title title={title} className="min-w-0 flex-1 truncate font-medium text-primary">
        {title}
      </span>
      <span data-frame-count className="inline-flex shrink-0 items-center gap-1 text-secondary" aria-label={`${panelCount} panneaux`}>
        <Layers size={12} aria-hidden />
        {panelCount}
      </span>
    </div>
  )
}
