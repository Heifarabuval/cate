// `cate.frame.*` (`cate panel group ...`): groups of canvas nodes as document
// frames. Every handler is synchronous on the runtime's document, so two
// concurrent calls apply one after the other and each reads the other's
// result (a second `add` sees the place the first one took).

import { randomUUID } from 'node:crypto'
import {
  boundingRect,
  frameBounds,
  frameOrigin,
  frameSlot,
  rectsOverlap,
  snapToGrid,
  PLACEMENT_GAP,
  type Point,
  type Rect,
} from '@workspace/canvas/contract'
import type { CateServiceHandlers } from '@kernel/api/contract'
import { RpcError } from '@kernel/rpc/contract'
import {
  canvasOf,
  docIndex,
  findFrame,
  frameOfPanel,
  framePanels,
  placementOf,
  isCanvasDock,
  type CanvasFrame,
  type CanvasId,
  type CanvasModel,
  type FrameId,
  type PanelId,
  type WorkspaceDocument,
} from '../contract'
import type { frameApi } from '../contract/api'
import type { DocumentService } from './documentService'

type Doc = WorkspaceDocument

/** Frames the "no match" error lists, at most. */
const NEAR_FRAMES = 10

const describeFrame = (frame: CanvasFrame): string => `${frame.id} (${frame.title})`

/** A frame from its id or a unique prefix of it. `gone` with the frames to
 *  pick from when the reference matches none or several. */
export function resolveFrameRef(doc: Doc, ref: string): CanvasFrame {
  const exact = findFrame(doc, ref)
  if (exact) return exact
  const all = Object.values(doc.canvases).flatMap((canvas) => Object.values(canvas.frames ?? {}))
  const matches = all.filter((frame) => frame.id.startsWith(ref))
  if (matches.length === 1) return matches[0]
  const listed = (matches.length > 0 ? matches : all).slice(0, NEAR_FRAMES).map(describeFrame).join(', ')
  const problem = matches.length === 0 ? `no group matching '${ref}'` : `ambiguous group '${ref}'`
  throw new RpcError('gone', `${problem}${listed ? `; groups: ${listed}` : '; there is no group'}`)
}

const canvasOfFrame = (doc: Doc, frame: CanvasFrame): CanvasModel => doc.canvases[docIndex(doc).frames.get(frame.id)!]

/** The canvas a new frame goes on: the one the `--canvas` panel shows or sits
 *  on, else the caller's. */
function targetCanvas(doc: Doc, canvasRef: PanelId | undefined, caller: PanelId | undefined): CanvasId {
  if (canvasRef !== undefined) {
    const canvasId = doc.panels[canvasRef]?.canvasId ?? canvasOf(doc, canvasRef)
    if (canvasId) return canvasId
    throw new RpcError('rejected', `panel ${canvasRef} shows no canvas and is not on one`)
  }
  const canvasId = caller ? canvasOf(doc, caller) : null
  if (!canvasId) throw new RpcError('rejected', 'the calling panel is not on a canvas: pass --canvas <id>')
  return canvasId
}

/** Where a new frame's title bar goes: under the caller's node, else under the
 *  canvas, and never on the bar of another frame. */
function newFrameAt(doc: Doc, canvas: CanvasModel, caller: PanelId | undefined): Point {
  const callerPlacement = caller ? placementOf(doc, caller) : null
  const callerNode = callerPlacement && isCanvasDock(callerPlacement.dock) && callerPlacement.dock.canvasId === canvas.id
    ? canvas.nodes[callerPlacement.dock.nodeId]
    : undefined
  const below = boundingRect(callerNode ? [callerNode.rect] : Object.values(canvas.nodes).map((node) => node.rect))
  let at = snapToGrid(below ? { x: below.origin.x, y: below.origin.y + below.size.height + PLACEMENT_GAP } : { x: 0, y: 0 })
  // Under whatever the bar would sit on: a frame as it is drawn now, or a node.
  const obstacles = [...frameRects(canvas), ...Object.values(canvas.nodes).map((node) => node.rect)]
  for (;;) {
    const bar = frameBounds([], at, false)
    const hit = obstacles.find((rect) => rectsOverlap(rect, bar))
    if (!hit) return at
    at = snapToGrid({ x: at.x, y: hit.origin.y + hit.size.height + PLACEMENT_GAP })
  }
}

/** The rect each frame of the canvas takes now (the frame `skip` left out). */
function frameRects(canvas: CanvasModel, skip?: FrameId): Rect[] {
  return Object.values(canvas.frames ?? {})
    .filter((frame) => frame.id !== skip)
    .map((frame) =>
      frameBounds(
        Object.values(canvas.nodes).filter((node) => node.frameId === frame.id).map((node) => node.rect),
        frame.at,
        frame.collapsed,
      ),
    )
}

export function createFrameApiHandlers(document: Pick<DocumentService, 'get' | 'apply'>): CateServiceHandlers<typeof frameApi> {
  /** Folds or unfolds, keeping the title bar where the members' frame is. */
  const fold = (ref: unknown, collapsed: boolean) => {
    const doc = document.get()
    const frame = resolveFrameRef(doc, ref as string)
    const members = Object.values(canvasOfFrame(doc, frame).nodes).filter((node) => node.frameId === frame.id)
    const at = frameOrigin(members.map((node) => node.rect)) ?? frame.at
    if (frame.collapsed !== collapsed || frame.at.x !== at.x || frame.at.y !== at.y) {
      document.apply({ kind: 'updateFrame', id: frame.id, patch: { collapsed, at } })
    }
    return { frameId: frame.id, collapsed }
  }
  return {
    create: ({ title, canvas }, ctx) => {
      const doc = document.get()
      const text = (title as string).trim()
      if (!text) throw new RpcError('rejected', 'a group needs a title')
      const canvasModel = doc.canvases[targetCanvas(doc, canvas as PanelId | undefined, ctx.caller.panelId)]
      const frameId = randomUUID()
      document.apply({
        kind: 'addFrame',
        canvasId: canvasModel.id,
        frame: { id: frameId, title: text, state: 'active', collapsed: false, at: newFrameAt(doc, canvasModel, ctx.caller.panelId) },
      })
      return { frameId, canvasId: canvasModel.id }
    },
    add: ({ frameId: ref, panelId }) => {
      const doc = document.get()
      const frame = resolveFrameRef(doc, ref as string)
      const canvas = canvasOfFrame(doc, frame)
      const id = panelId as PanelId
      if (doc.panels[id]?.canvasId !== undefined) throw new RpcError('rejected', `panel ${id} shows a canvas, it is never on one`)
      const dock = placementOf(doc, id)?.dock
      if (!dock) throw new RpcError('gone', `panel ${id} is gone`)
      if (!isCanvasDock(dock)) throw new RpcError('rejected', `panel ${id} is in a window, not on canvas ${canvas.id}`)
      if (dock.canvasId !== canvas.id) throw new RpcError('rejected', `panel ${id} is on canvas ${dock.canvasId}, not on canvas ${canvas.id}`)
      const node = canvas.nodes[dock.nodeId]
      if (node.frameId === frame.id) return { frameId: frame.id, panelId: id, nodeId: node.id, moved: false }

      const others = Object.values(canvas.nodes).filter((other) => other.id !== node.id)
      const members: Rect[] = others.filter((other) => other.frameId === frame.id).map((other) => other.rect)
      const origin = frameSlot(members, others.map((other) => other.rect), frame.at, node.rect.size, frameRects(canvas, frame.id))
      document.apply({
        kind: 'batch',
        changes: [
          { kind: 'setNodeFrame', canvasId: canvas.id, nodeId: node.id, frameId: frame.id },
          { kind: 'setNodeRects', canvasId: canvas.id, rects: [{ nodeId: node.id, rect: { origin, size: node.rect.size } }] },
        ],
      })
      return { frameId: frame.id, panelId: id, nodeId: node.id, moved: true }
    },
    state: ({ frameId: ref, state }) => {
      const frame = resolveFrameRef(document.get(), ref as string)
      document.apply({ kind: 'updateFrame', id: frame.id, patch: { state } })
      return { frameId: frame.id, state }
    },
    collapse: ({ frameId }) => fold(frameId, true),
    expand: ({ frameId }) => fold(frameId, false),
    remove: ({ panelId }) => {
      const id = panelId as PanelId
      const doc = document.get()
      const frame = frameOfPanel(doc, id)
      const dock = placementOf(doc, id)?.dock
      if (!frame || !dock || !isCanvasDock(dock)) return { frameId: null, panelId: id }
      document.apply({ kind: 'setNodeFrame', canvasId: dock.canvasId, nodeId: dock.nodeId, frameId: null })
      return { frameId: frame.id, panelId: id }
    },
    delete: ({ frameId: ref }) => {
      const doc = document.get()
      const frame = resolveFrameRef(doc, ref as string)
      const panelIds = framePanels(doc, frame.id)
      document.apply({ kind: 'removeFrame', id: frame.id })
      return { frameId: frame.id, panelIds }
    },
    list: () => {
      const doc = document.get()
      return Object.values(doc.canvases).flatMap((canvas) =>
        Object.values(canvas.frames ?? {}).map((frame) => ({
          frameId: frame.id,
          canvasId: canvas.id,
          title: frame.title,
          state: frame.state,
          collapsed: frame.collapsed,
          panelIds: framePanels(doc, frame.id),
        })),
      )
    },
  }
}
