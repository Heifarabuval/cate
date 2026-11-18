import { describe, expect, it } from 'vitest'
import { rect } from '@workspace/canvas/contract'
import { applyOp } from './apply'
import { applicable, invertOp } from './invert'
import type { DocBatch, DocChange, DockRef, PlaceTarget } from './ops'
import { createDocument, MAIN_WINDOW, type PanelRecord, type PanelType, type WorkspaceDocument } from './schema'

type Doc = WorkspaceDocument
const MAIN: DockRef = { windowId: MAIN_WINDOW }
const R = rect(0, 0, 400, 300)

const record = (id: string, type: PanelType = 'terminal'): PanelRecord =>
  ({ id, type, title: id, fields: {}, ...(type === 'canvas' ? { canvasId: `canvas-${id}` } : {}) })
const tab = (stackId: string, dock: DockRef = MAIN): PlaceTarget => ({ to: 'stack', dock, stackId })
const add = (id: string, at: PlaceTarget, type: PanelType = 'terminal'): DocChange => ({ kind: 'addPanel', record: record(id, type), at })

function build(...changes: DocChange[]): Doc {
  const result = applyOp(createDocument(), { kind: 'batch', changes })
  if (result.error) throw new Error(result.error.message)
  return result.doc
}

let n = 0
const newId = () => `new-${++n}`

/** Apply, invert, apply the inverse: back to where it started. */
function roundTrip(before: Doc, change: DocChange): DocChange[] {
  const after = applyOp(before, change)
  expect(after.error).toBeUndefined()
  const inverse = invertOp(before, change, newId)
  const undone = applyOp(after.doc, { kind: 'batch', changes: inverse })
  expect(undone.error).toBeUndefined()
  expect(undone.doc).toEqual(before)
  return inverse
}

// main: H(p1)[s1(a, b), V(p2)[s2(c), s3(d)]] with ratios set; canvas panel cv
// on a tab in s1 whose canvas has node n1(x, y) and n2(z); detached w1(w).
function sample(): Doc {
  return build(
    add('a', tab('s1')), add('b', tab('s1')),
    add('c', { to: 'split', dock: MAIN, beside: 's1', side: 'right', stackId: 's2', splitId: 'p1' }),
    add('d', { to: 'split', dock: MAIN, beside: 's2', side: 'bottom', stackId: 's3', splitId: 'p2' }),
    { kind: 'setSplitRatio', splitId: 'p1', ratios: [0.7, 0.3] },
    { kind: 'setSplitRatio', splitId: 'p2', ratios: [0.2, 0.8] },
    add('cv', tab('s1'), 'canvas'),
    add('x', { to: 'canvas', canvasId: 'canvas-cv', nodeId: 'n1', stackId: 'sn1', rect: R }),
    add('y', tab('sn1', { canvasId: 'canvas-cv', nodeId: 'n1' })),
    add('z', { to: 'canvas', canvasId: 'canvas-cv', nodeId: 'n2', stackId: 'sn2', rect: rect(500, 0, 300, 200) }),
    add('w', { to: 'window', windowId: 'w1', stackId: 'sw' }),
    { kind: 'addRelation', relation: { id: 'r1', fromPanelId: 'a', toPanelId: 'x', kind: 'context', label: 'L' } },
    { kind: 'setWorktree', worktree: { id: 'wt', path: '/r/wt', color: '#fff', status: 'ready' } },
  )
}

describe('invertOp', () => {
  it('undoes addPanel with removePanels', () => {
    expect(roundTrip(sample(), add('e', tab('s2')))).toEqual([{ kind: 'removePanels', ids: ['e'] }])
  })

  it('undoes a removal: records, placement, emptied stacks and splits, ratios, relations', () => {
    const doc = sample()
    roundTrip(doc, { kind: 'removePanels', ids: ['c'] })
    roundTrip(doc, { kind: 'removePanels', ids: ['a', 'd', 'w'] })
    roundTrip(doc, { kind: 'removePanels', ids: ['x'] })
  })

  it('undoes removing a canvas panel: canvas, nodes and rects come back', () => {
    roundTrip(sample(), { kind: 'removePanels', ids: ['cv'] })
  })

  it('undoes moves out of stacks, splits, nodes and windows', () => {
    const doc = sample()
    roundTrip(doc, { kind: 'placePanel', id: 'c', at: tab('s1') })
    roundTrip(doc, { kind: 'placePanel', id: 'b', at: { to: 'stack', dock: MAIN, stackId: 's1', after: null } })
    roundTrip(doc, { kind: 'placePanel', id: 'z', at: tab('s3') })
    roundTrip(doc, { kind: 'placePanel', id: 'w', at: tab('s2') })
    roundTrip(doc, { kind: 'placePanel', id: 'd', at: { to: 'window', windowId: 'w2', stackId: 'sw2' } })
    roundTrip(doc, { kind: 'placePanel', id: 'a', at: { to: 'split', dock: MAIN, beside: 'p1', side: 'bottom', stackId: 's9', splitId: 'p9' } })
  })

  it('undoes closeWindow and the container and record edits', () => {
    const doc = sample()
    roundTrip(doc, { kind: 'closeWindow', windowId: 'w1' })
    roundTrip(doc, { kind: 'setSplitRatio', splitId: 'p1', ratios: [1, 1] })
    roundTrip(doc, { kind: 'setNodeRects', canvasId: 'canvas-cv', rects: [{ nodeId: 'n2', rect: R }] })
    roundTrip(doc, { kind: 'updatePanel', id: 'a', patch: { title: 'T', worktreeId: 'wt', fields: { k: 1 } } })
    roundTrip(doc, { kind: 'replacePanel', record: record('a', 'browser') })
  })

  it('undoes relation and worktree ops', () => {
    const doc = sample()
    roundTrip(doc, { kind: 'addRelation', relation: { id: 'r2', fromPanelId: 'b', toPanelId: 'c', kind: 'use' } })
    roundTrip(doc, { kind: 'updateRelation', id: 'r1', patch: { label: null, kind: 'use', waypoint: { x: 1, y: 1 } } })
    roundTrip(doc, { kind: 'removeRelation', id: 'r1' })
    roundTrip(doc, { kind: 'setWorktree', worktree: { id: 'wt2', path: '/r/2', color: '#000', status: 'creating' } })
    roundTrip(doc, { kind: 'setWorktree', worktree: { id: 'wt', path: '/r/wt', color: '#000', status: 'removing' } })
    roundTrip(doc, { kind: 'removeWorktree', id: 'wt' })
  })

  it('undoes a batch in reverse order', () => {
    roundTrip(sample(), {
      kind: 'batch',
      changes: [add('e', tab('s2')), { kind: 'placePanel', id: 'e', at: tab('s1') }, { kind: 'removePanels', ids: ['c'] }],
    } as unknown as DocChange)
  })

  it('has nothing to undo for an op that failed', () => {
    expect(invertOp(sample(), { kind: 'removePanels', ids: ['nope'] }, newId)).toEqual([])
  })
})

// sample() plus, on canvas-cv: frame f1 holding n1 and n2, f2 holding nothing.
// f1 is waiting, collapsed, with its own `at`, so a restore that resets them shows.
function framed(): Doc {
  const at = { x: -20, y: -60 }
  const result = applyOp(sample(), {
    kind: 'batch',
    changes: [
      { kind: 'addFrame', canvasId: 'canvas-cv', frame: { id: 'f1', title: 'Besoin', state: 'waiting', collapsed: true, at } },
      { kind: 'addFrame', canvasId: 'canvas-cv', frame: { id: 'f2', title: 'Vide', state: 'active', collapsed: false, at } },
      { kind: 'setNodeFrame', canvasId: 'canvas-cv', nodeId: 'n1', frameId: 'f1' },
      { kind: 'setNodeFrame', canvasId: 'canvas-cv', nodeId: 'n2', frameId: 'f1' },
    ],
  })
  if (result.error) throw new Error(result.error.message)
  return result.doc
}

describe('invertOp with frames (A001)', () => {
  it('builds the framed sample', () => {
    const doc = framed()
    expect(doc.canvases['canvas-cv'].frames?.f1?.state).toBe('waiting')
    expect(doc.canvases['canvas-cv'].nodes.n2.frameId).toBe('f1')
  })

  it('undoes closing a member whose node goes: the node is back in its frame', () => {
    roundTrip(framed(), { kind: 'removePanels', ids: ['z'] })
  })

  it('undoes closing the last members: the frame comes back before its memberships', () => {
    const doc = framed()
    const after = applyOp(doc, { kind: 'removePanels', ids: ['x', 'y', 'z'] }).doc
    expect(after.canvases['canvas-cv'].frames?.f1).toBeUndefined()
    const inverse = roundTrip(doc, { kind: 'removePanels', ids: ['x', 'y', 'z'] })
    const frameAt = inverse.findIndex((c) => c.kind === 'addFrame')
    const firstMember = inverse.findIndex((c) => c.kind === 'setNodeFrame')
    expect(frameAt).toBeGreaterThanOrEqual(0)
    expect(frameAt).toBeLessThan(firstMember)
  })

  it('undoes removing the canvas panel: its frames, empty ones too, and memberships come back', () => {
    roundTrip(framed(), { kind: 'removePanels', ids: ['cv'] })
  })
})

const kinds = (changes: DocChange[]) => changes.map((c) => c.kind)

describe('invertOp, the four frame ops (A013)', () => {
  const CV = 'canvas-cv'
  const f3 = { id: 'f3', title: 'Neuf', state: 'active', collapsed: false, at: { x: 5, y: 5 } } as const

  it('undoes addFrame with removeFrame', () => {
    expect(roundTrip(framed(), { kind: 'addFrame', canvasId: CV, frame: f3 })).toEqual([{ kind: 'removeFrame', id: 'f3' }])
  })

  it('undoes updateFrame to the old values, only the keys it set', () => {
    const inverse = roundTrip(framed(), { kind: 'updateFrame', id: 'f1', patch: { title: 'T', state: 'done', collapsed: false, at: { x: 1, y: 2 } } })
    expect(inverse).toEqual([{ kind: 'updateFrame', id: 'f1', patch: { title: 'Besoin', state: 'waiting', collapsed: true, at: { x: -20, y: -60 } } }])
    expect(roundTrip(framed(), { kind: 'updateFrame', id: 'f1', patch: { state: 'blocked' } })).toEqual([{ kind: 'updateFrame', id: 'f1', patch: { state: 'waiting' } }])
  })

  it('undoes removeFrame with addFrame then one setNodeFrame per former member', () => {
    expect(kinds(roundTrip(framed(), { kind: 'removeFrame', id: 'f1' }))).toEqual(['addFrame', 'setNodeFrame', 'setNodeFrame'])
    expect(kinds(roundTrip(framed(), { kind: 'removeFrame', id: 'f2' }))).toEqual(['addFrame'])
  })

  it('undoes setNodeFrame to the old frame, or to none', () => {
    const doc = framed()
    expect(roundTrip(doc, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f2' })).toEqual([{ kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f1' }])
    expect(roundTrip(doc, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: null })).toEqual([{ kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f1' }])
    const loose = applyOp(doc, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: null }).doc
    expect(roundTrip(loose, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f2' })).toEqual([{ kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: null }])
  })

  it('undoes a move of a frame (node rects and anchor) in one step', () => {
    const inverse = roundTrip(framed(), {
      kind: 'batch',
      changes: [
        { kind: 'setNodeRects', canvasId: CV, rects: [{ nodeId: 'n1', rect: rect(50, 50, 400, 300) }, { nodeId: 'n2', rect: rect(550, 50, 300, 200) }] },
        { kind: 'updateFrame', id: 'f1', patch: { at: { x: 30, y: -10 } } },
      ],
    } as unknown as DocChange)
    expect(kinds(inverse)).toEqual(['updateFrame', 'setNodeRects'])
  })

  it('undoes a placePanel that takes the only member of a node out: the node is back in its frame', () => {
    roundTrip(framed(), { kind: 'placePanel', id: 'z', at: tab('s2') })
    roundTrip(framed(), { kind: 'placePanel', id: 'x', at: tab('s2') })
  })

  it('restores the frame only after the canvas panel it lives on, and each membership on the node the restore gave back', () => {
    const inverse = roundTrip(framed(), { kind: 'removePanels', ids: ['cv'] })
    const last = (kind: string) => inverse.map((c) => c.kind).lastIndexOf(kind as DocChange['kind'])
    expect(last('addPanel')).toBeLessThan(inverse.map((c) => c.kind).indexOf('addFrame'))
    expect(last('addFrame')).toBeLessThan(inverse.map((c) => c.kind).indexOf('setNodeFrame'))
    expect(inverse.filter((c) => c.kind === 'addFrame')).toHaveLength(2)
  })

  it('puts no setNodeFrame for a tab closed in a node that stays', () => {
    expect(kinds(roundTrip(framed(), { kind: 'removePanels', ids: ['y'] }))).toEqual(['addPanel'])
  })

  it('redo: the inverse of the undo brings the op back, with the frame gone again', () => {
    const cases: DocChange[] = [
      { kind: 'removePanels', ids: ['x', 'y', 'z'] },
      { kind: 'removePanels', ids: ['z'] },
      { kind: 'removePanels', ids: ['cv'] },
      { kind: 'removeFrame', id: 'f1' },
      { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f2' },
      { kind: 'addFrame', canvasId: CV, frame: f3 }
    ]
    for (const change of cases) {
      const before = framed()
      const after = applyOp(before, change)
      expect(after.error).toBeUndefined()
      const undo = invertOp(before, change, newId)
      const undone = applyOp(after.doc, { kind: 'batch', changes: undo })
      expect(undone.error).toBeUndefined()
      expect(undone.doc).toEqual(before)
      const redo = invertOp(after.doc, { kind: 'batch', changes: undo }, newId)
      const redone = applyOp(undone.doc, { kind: 'batch', changes: redo })
      expect(redone.error, JSON.stringify(change)).toBeUndefined()
      expect(redone.doc, JSON.stringify(change)).toEqual(after.doc)
    }
  })
})

describe('applicable with frames, after a concurrent edit (A013)', () => {
  const CV = 'canvas-cv'
  const g = { id: 'g', title: 'Autre', state: 'active', collapsed: false, at: { x: 0, y: 0 } } as const
  const send = (doc: Doc, change: DocChange) => {
    const result = applyOp(doc, change)
    expect(result.error).toBeUndefined()
    return result.doc
  }

  it('undoes removeFrame but leaves a node someone put in another frame since', () => {
    const before = send(framed(), { kind: 'addFrame', canvasId: CV, frame: g })
    const change: DocChange = { kind: 'removeFrame', id: 'f1' }
    const after = send(before, change)
    const inverse = invertOp(before, change, newId)
    const later = send(after, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n2', frameId: 'g' })
    const kept = applicable(later, inverse, after)
    expect(kinds(kept)).toEqual(['addFrame', 'setNodeFrame'])
    const undone = applyOp(later, { kind: 'batch', changes: kept }).doc
    expect(undone.canvases[CV].nodes.n1.frameId).toBe('f1')
    expect(undone.canvases[CV].nodes.n2.frameId).toBe('g')
    expect(undone.canvases[CV].frames?.f1).toEqual(before.canvases[CV].frames?.f1)
  })

  it('undoes the closing of the last members: all of it when nothing changed, nothing when the canvas went', () => {
    const before = framed()
    const change: DocChange = { kind: 'removePanels', ids: ['x', 'y', 'z'] }
    const after = send(before, change)
    const inverse = invertOp(before, change, newId)
    expect(applicable(after, inverse, after)).toEqual(inverse)
    const gone = send(after, { kind: 'removePanels', ids: ['cv'] })
    expect(applicable(gone, inverse, after)).toEqual([])
  })

  it('does not replace a frame someone created under the same id since', () => {
    const before = framed()
    const change: DocChange = { kind: 'removePanels', ids: ['x', 'y', 'z'] }
    const after = send(before, change)
    const inverse = invertOp(before, change, newId)
    const later = send(after, { kind: 'addFrame', canvasId: CV, frame: { ...g, id: 'f1' } })
    const kept = applicable(later, inverse, after)
    expect(kinds(kept)).not.toContain('addFrame')
    const undone = applyOp(later, { kind: 'batch', changes: kept }).doc
    expect(undone.canvases[CV].frames?.f1?.title).toBe('Autre')
  })

  it('undoes updateFrame but keeps a key someone changed since', () => {
    const before = framed()
    const change: DocChange = { kind: 'updateFrame', id: 'f1', patch: { title: 'T', state: 'done' } }
    const after = send(before, change)
    const inverse = invertOp(before, change, newId)
    const later = send(after, { kind: 'updateFrame', id: 'f1', patch: { title: 'B' } })
    const undone = applyOp(later, { kind: 'batch', changes: applicable(later, inverse, after) }).doc
    expect(undone.canvases[CV].frames?.f1).toMatchObject({ title: 'B', state: 'waiting' })
  })

  it('does not put a node back in its frame when someone moved it since', () => {
    const before = framed()
    const change: DocChange = { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: 'f2' }
    const after = send(before, change)
    const inverse = invertOp(before, change, newId)
    const later = send(after, { kind: 'setNodeFrame', canvasId: CV, nodeId: 'n1', frameId: null })
    expect(applicable(later, inverse, after)).toEqual([])
    expect(applicable(after, inverse, after)).toEqual(inverse)
  })
})

describe('applicable', () => {
  it('skips the parts of an inverse that are gone by the time it is sent', () => {
    const before = sample()
    const change: DocChange = { kind: 'updatePanel', id: 'c', patch: { title: 'T' } }
    const after = applyOp(before, change).doc
    const inverse = [...invertOp(before, change, newId), { kind: 'removeRelation', id: 'r1' } as DocChange]
    // Someone else removed c and r1 in the meantime.
    const later = applyOp(after, { kind: 'removePanels', ids: ['c', 'a'] }).doc
    expect(applicable(later, inverse)).toEqual([])
    expect(applicable(after, inverse)).toEqual(inverse)
  })

  it('leaves what someone changed after the op, and restores the rest', () => {
    const before = sample()
    const change: DocBatch = {
      kind: 'batch',
      changes: [
        { kind: 'updatePanel', id: 'c', patch: { title: 'T', fields: { k: 1, j: 2 } } },
        { kind: 'setNodeRects', canvasId: 'canvas-cv', rects: [{ nodeId: 'n1', rect: rect(1, 1, 10, 10) }, { nodeId: 'n2', rect: rect(2, 2, 10, 10) }] },
        { kind: 'updateRelation', id: 'r1', patch: { label: 'M' } },
      ],
    }
    const after = applyOp(before, change).doc
    const inverse = invertOp(before, change, newId)
    expect(applyOp(after, { kind: 'batch', changes: applicable(after, inverse, after) }).doc).toEqual(before)

    const later = applyOp(after, {
      kind: 'batch',
      changes: [
        { kind: 'updatePanel', id: 'c', patch: { title: 'B', fields: { k: 9 } } },
        { kind: 'setNodeRects', canvasId: 'canvas-cv', rects: [{ nodeId: 'n2', rect: rect(3, 3, 10, 10) }] },
        { kind: 'updateRelation', id: 'r1', patch: { label: 'B' } },
      ],
    }).doc
    const undone = applyOp(later, { kind: 'batch', changes: applicable(later, inverse, after) }).doc
    expect(undone.panels.c.title).toBe('B')
    expect(undone.panels.c.fields).toEqual({ k: 9 })
    expect(undone.canvases['canvas-cv'].nodes.n1.rect).toEqual(R)
    expect(undone.canvases['canvas-cv'].nodes.n2.rect).toEqual(rect(3, 3, 10, 10))
    expect(undone.relations.r1.label).toBe('B')
  })

  it('does not put back a replaced record that changed since', () => {
    const before = sample()
    const change: DocChange = { kind: 'replacePanel', record: { ...record('c'), type: 'editor', fields: { path: '/a' } } }
    const after = applyOp(before, change).doc
    const inverse = invertOp(before, change, newId)
    expect(applicable(after, inverse, after)).toEqual(inverse)
    const later = applyOp(after, { kind: 'updatePanel', id: 'c', patch: { title: 'B' } }).doc
    expect(applicable(later, inverse, after)).toEqual([])
  })
})
