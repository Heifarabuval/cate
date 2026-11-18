import { describe, expect, it } from 'vitest'
import { rect } from '@workspace/canvas/contract'
import { applyOp } from './apply'
import type { DocChange } from './ops'
import { allStacks, canvasOf, canvasPanelOf, documentOrder, dockTargetOf, panelsInWindow, panelsOnCanvas, stacksIn, windowOf } from './selectors'
import { createDocument, type WorkspaceDocument } from './schema'
import { DOCUMENT_FILE_VERSION, parseDocument, validateDocument } from './serialize'

const R = rect(0, 0, 400, 300)

function sample(): WorkspaceDocument {
  const changes: DocChange[] = [
    { kind: 'addPanel', record: { id: 'a', type: 'terminal', title: 'a', fields: { n: 1 } }, at: { to: 'stack', dock: { windowId: 'main' }, stackId: 's1' } },
    { kind: 'addPanel', record: { id: 'cv', type: 'canvas', title: 'cv', canvasId: 'c1', fields: {} }, at: { to: 'split', dock: { windowId: 'main' }, beside: 's1', side: 'right', stackId: 's2', splitId: 'p1' } },
    { kind: 'addPanel', record: { id: 'x', type: 'editor', title: 'x', fields: {} }, at: { to: 'canvas', canvasId: 'c1', nodeId: 'n1', stackId: 'sn1', rect: R } },
    { kind: 'addPanel', record: { id: 'w', type: 'browser', title: 'w', fields: {} }, at: { to: 'window', windowId: 'w1', stackId: 'sw' } },
    { kind: 'addPanel', record: { id: 'cv2', type: 'canvas', title: 'cv2', canvasId: 'c2', fields: {} }, at: { to: 'stack', dock: { windowId: 'w1' }, stackId: 'sw' } },
    { kind: 'addPanel', record: { id: 'y', type: 'review', title: 'y', fields: {} }, at: { to: 'canvas', canvasId: 'c2', nodeId: 'n2', stackId: 'sn2', rect: R } },
    { kind: 'addRelation', relation: { id: 'r1', fromPanelId: 'a', toPanelId: 'x', kind: 'use' } },
    { kind: 'setWorktree', worktree: { id: 'wt', path: '/r', color: '#fff', status: 'ready' } },
  ]
  const result = applyOp(createDocument(), { kind: 'batch', changes })
  if (result.error) throw new Error(result.error.message)
  return result.doc
}

const file = (document: unknown) => JSON.stringify({ version: DOCUMENT_FILE_VERSION, document })

describe('document.json', () => {

  it('rejects anything that is not a version 1 document file', () => {
    expect(parseDocument('{').ok).toBe(false)
    expect(parseDocument(JSON.stringify(sample())).ok).toBe(false)
    expect(parseDocument(JSON.stringify({ version: 2, document: sample() })).ok).toBe(false)
  })

  it('rejects documents that break an invariant', () => {
    const doc = sample()
    const broken: [string, (d: WorkspaceDocument) => unknown][] = [
      ['old panel type', (d) => ({ ...d, panels: { ...d.panels, a: { ...d.panels.a, type: 'agent' } } })],
      ['unplaced panel', (d) => ({ ...d, panels: { ...d.panels, q: { id: 'q', type: 'terminal', title: '', fields: {} } } })],
      ['placed twice', (d) => ({ ...d, windows: { ...d.windows, main: { ...d.windows.main, dock: { kind: 'stack', id: 's9', panels: ['a', 'a', 'cv'] } } } })],
      ['missing main', (d) => ({ ...d, windows: { w1: d.windows.w1 } })],
      ['detached window with a position', (d) => ({ ...d, windows: { ...d.windows, w1: { ...d.windows.w1, bounds: R } } })],
      ['one-child split', (d) => ({ ...d, windows: { ...d.windows, main: { ...d.windows.main, dock: { kind: 'split', id: 'p', direction: 'horizontal', children: [{ kind: 'stack', id: 's1', panels: ['a', 'cv'] }], ratios: [1] } } } })],
      ['canvas without panel', (d) => ({ ...d, canvases: { ...d.canvases, c9: { id: 'c9', nodes: {} } } })],
      ['canvas panel on a canvas', (d) => ({ ...d, canvases: { ...d.canvases, c1: { ...d.canvases.c1, nodes: { n1: { ...d.canvases.c1.nodes.n1, dock: { kind: 'stack', id: 'sn1', panels: ['x', 'cv2'] } } } } }, windows: { ...d.windows, w1: { ...d.windows.w1, dock: { kind: 'stack', id: 'sw', panels: ['w'] } } } })],
      ['relation to a missing panel', (d) => ({ ...d, relations: { r1: { ...d.relations.r1, toPanelId: 'nope' } } })],
      ['bad worktree status', (d) => ({ ...d, worktrees: { wt: { ...d.worktrees.wt, status: 'done' } } })],
      ['extra key', (d) => ({ ...d, activeCanvasId: 'c1' })],
    ]
    for (const [name, mutate] of broken) {
      expect(parseDocument(file(mutate(doc))).ok, name).toBe(false)
    }
    expect(validateDocument(doc)).toBeNull()
  })
})

describe('document.json with frames', () => {
type Raw = { canvases: Record<string, { frames?: Record<string, unknown>; nodes: Record<string, { frameId?: unknown }> }> }
const frame = (id: string, extra: Record<string, unknown> = {}) =>
({ id, title: 'Besoin', state: 'waiting', collapsed: false, at: { x: 0, y: -40 }, ...extra })

/** sample() as plain JSON, with frame f1 on c1 holding n1, and f2 on c2 holding n2. */
function framed(edit?: (raw: Raw) => void): unknown {
const raw = JSON.parse(JSON.stringify(sample())) as Raw
raw.canvases.c1.frames = { f1: frame('f1') }
raw.canvases.c1.nodes.n1.frameId = 'f1'
raw.canvases.c2.frames = { f2: frame('f2', { state: 'done', collapsed: true }) }
raw.canvases.c2.nodes.n2.frameId = 'f2'
edit?.(raw)
return raw
}

it('keeps the file version at 1', () => {
expect(DOCUMENT_FILE_VERSION).toBe(1)
})

it('reads a document without frames unchanged, byte for byte', () => {
const text = file(sample())
const parsed = parseDocument(text)
expect(parsed.ok).toBe(true)
expect(parsed.ok && file(parsed.doc)).toBe(text)
})

it('reads a valid document with frames, an empty frame and a collapsed one included', () => {
expect(validateDocument(framed())).toBeNull()
expect(parseDocument(file(framed((raw) => { raw.canvases.c1.frames!.f3 = frame('f3') }))).ok).toBe(true)
})

it('refuses a frame or a membership that breaks an invariant', () => {
const broken: [string, (raw: Raw) => void][] = [
['orphan frameId', (raw) => { raw.canvases.c1.nodes.n1.frameId = 'nope' }],
['frameId of another canvas', (raw) => { raw.canvases.c1.nodes.n1.frameId = 'f2' }],
['frameId that is not an id', (raw) => { raw.canvases.c1.nodes.n1.frameId = 3 }],
['frameId on a canvas without frames', (raw) => { delete raw.canvases.c1.frames }],
['unknown state', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { state: 'paused' }) }],
['empty title', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { title: '' }) }],
['title on two lines', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { title: 'a\nb' }) }],
['collapsed that is not a boolean', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { collapsed: 'no' }) }],
['at that is not a point', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { at: { x: 1 } }) }],
['unknown key on a frame', (raw) => { raw.canvases.c1.frames!.f1 = frame('f1', { color: 'red' }) }],
['frame filed under the wrong key', (raw) => { raw.canvases.c1.frames!.f9 = frame('f1') }],
['frame id used on two canvases', (raw) => { raw.canvases.c2.frames!.f1 = frame('f1') }],
['frames that is not an object', (raw) => { raw.canvases.c1.frames = [] as unknown as Record<string, unknown> }]
]
for (const [name, edit] of broken) {
expect(parseDocument(file(framed(edit))).ok, name).toBe(false)
}
})
})

describe('selectors', () => {
  it('list panels by window and canvas, and find where a panel shows', () => {
    const doc = sample()
    expect(panelsInWindow(doc, 'main')).toEqual(['a', 'cv', 'x'])
    expect(panelsInWindow(doc, 'w1')).toEqual(['w', 'cv2', 'y'])
    expect(panelsOnCanvas(doc, 'c1')).toEqual(['x'])
    expect(canvasOf(doc, 'x')).toBe('c1')
    expect(canvasOf(doc, 'a')).toBeNull()
    expect(canvasPanelOf(doc, 'c2')?.id).toBe('cv2')
    expect(windowOf(doc, 'y')).toBe('w1')
    expect(windowOf(doc, 'a')).toBe('main')
    expect(windowOf(doc, 'nope')).toBeNull()
  })

  it('places a canvas panel\'s tab beside its canvas panel in the dock', () => {
    const doc = sample()
    expect(dockTargetOf(doc, 'y')).toEqual({ to: 'stack', dock: { windowId: 'w1' }, stackId: 'sw', after: 'cv2' })
    expect(dockTargetOf(doc, 'a')).toBeNull()
  })

  it('list stacks and the document order', () => {
    const doc = sample()
    expect(stacksIn(doc, { windowId: 'main' }).map((s) => s.id)).toEqual(['s1', 's2'])
    expect(allStacks(doc).map((s) => s.stack.id)).toEqual(['s1', 's2', 'sw', 'sn1', 'sn2'])
    expect(documentOrder(doc)).toEqual(['a', 'cv', 'w', 'cv2', 'x', 'y'])
  })
})
