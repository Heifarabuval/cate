// Property tests over seeded random changes: every applied change keeps the
// document valid and never mutates its input, and its inverse restores the
// document it applied to.

import { describe, expect, it } from 'vitest'
import { applyOp } from './apply'
import { applicable, invertOp } from './invert'
import { createRng, randomChange } from '../../../test/documentFuzz'
import { createDocument, type WorkspaceDocument } from './schema'
import { validateDocument } from './serialize'
import { placementOf } from './placement'
import type { DocChange } from './ops'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

function run(seed: number, steps: number, onStep: (before: WorkspaceDocument, change: DocChange, after: WorkspaceDocument, ok: boolean) => void, frames = false) {
  const rng = createRng(seed)
  let n = 0
  const newId = () => `${seed}-${++n}`
  let doc = deepFreeze(createDocument())
  for (let i = 0; i < steps; i++) {
    const change = randomChange(doc, rng, newId, frames)
    const result = applyOp(doc, change)
    onStep(doc, change, result.doc, !result.error)
    if (!result.error) doc = deepFreeze(result.doc)
  }
  return doc
}

function placements(doc: WorkspaceDocument) {
  return Object.fromEntries(Object.keys(doc.panels).map((id) => [id, placementOf(doc, id)]))
}

function withoutTrees(doc: WorkspaceDocument) {
  return {
    ...doc,
    windows: Object.fromEntries(Object.entries(doc.windows).map(([id, w]) => [id, { ...w, dock: null }])),
    canvases: Object.fromEntries(Object.entries(doc.canvases).map(([id, c]) => [id, {
      ...c,
      nodes: Object.fromEntries(Object.entries(c.nodes).map(([nodeId, n]) => [nodeId, { ...n, dock: null }])),
    }])),
  }
}

/** Key order is not state: compare with sorted keys. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]))
  }
  return value
}

describe('random changes', () => {
  it('keep the document valid, fail without changes, and never mutate the input', () => {
    let applied = 0
    let failed = 0
    for (let seed = 1; seed <= 40; seed++) {
      run(seed, 150, (before, change, after, ok) => {
        if (ok) {
          applied++
          const problem = validateDocument(after)
          if (problem) throw new Error(`${problem} after ${JSON.stringify(change)}`)
        } else {
          failed++
          expect(after).toBe(before)
        }
      })
    }
    expect(applied).toBeGreaterThan(2000)
    expect(failed).toBeGreaterThan(200)
  })

  // A015: the frame invariants, after every change, on a run where frames really happen.
  it('keep every frameId on a frame of its own canvas, ids unique, and no frame left empty by a removal', () => {
    const framesOf = (doc: WorkspaceDocument) => Object.values(doc.canvases).flatMap((c) => Object.values(c.frames ?? {}))
    const members = (doc: WorkspaceDocument, frameId: string) =>
      Object.values(doc.canvases).flatMap((c) => Object.values(c.nodes)).filter((n) => n.frameId === frameId).length
    const applied: Record<string, number> = {}
    let dissolvedByRemoval = 0
    for (let seed = 200; seed <= 260; seed++) {
      run(seed, 200, (before, change, after, ok) => {
        if (!ok) return
        applied[change.kind] = (applied[change.kind] ?? 0) + 1
        const ids = framesOf(after).map((f) => f.id)
        expect(new Set(ids).size, JSON.stringify(change)).toBe(ids.length)
        for (const canvas of Object.values(after.canvases)) {
          for (const node of Object.values(canvas.nodes)) {
            if (node.frameId !== undefined) expect(canvas.frames?.[node.frameId], `${node.id} after ${JSON.stringify(change)}`).toBeDefined()
          }
          expect('frames' in canvas && Object.keys(canvas.frames ?? {}).length === 0, 'empty frames key').toBe(false)
        }
        const removal = change.kind === 'removePanels' || change.kind === 'closeWindow'
        for (const frame of framesOf(before)) {
          const kept = framesOf(after).some((f) => f.id === frame.id)
          if (removal) {
            if (members(before, frame.id) === 0) continue
            if (!kept) dissolvedByRemoval++
            else expect(members(after, frame.id), `frame ${frame.id} left empty by ${JSON.stringify(change)}`).toBeGreaterThan(0)
          } else if (change.kind !== 'removeFrame') {
            expect(kept, `${frame.id} lost by ${change.kind}`).toBe(true)
          }
        }
      }, true)
    }
    for (const kind of ['addFrame', 'updateFrame', 'removeFrame', 'setNodeFrame']) expect(applied[kind], kind).toBeGreaterThan(40)
    expect(dissolvedByRemoval).toBeGreaterThan(5)
  })

  // A removal can collapse two levels of splits into their grandparent; one
  // split target cannot regroup those siblings, so the inverse restores
  // every tab to its stack but may flatten that part of the tree.
  it('are undone by their inverse: every tab back in its stack, the tree nearly always exact', () => {
    let checked = 0
    let exact = 0
    for (let seed = 100; seed <= 140; seed++) {
      let n = 0
      const newId = () => `undo-${seed}-${++n}`
      run(seed, 120, (before, change, after, ok) => {
        if (!ok) return
        const inverse = invertOp(before, change, newId)
        const undone = applyOp(after, { kind: 'batch', changes: inverse })
        if (undone.error) throw new Error(`inverse of ${JSON.stringify(change)} failed: ${undone.error.message}`)
        expect(withoutTrees(undone.doc), JSON.stringify(change)).toEqual(withoutTrees(before))
        expect(placements(undone.doc), JSON.stringify(change)).toEqual(placements(before))
        expect(applicable(after, inverse)).toEqual(inverse)
        expect(applicable(after, inverse, after)).toEqual(inverse)
        if (JSON.stringify(sorted(undone.doc)) === JSON.stringify(sorted(before))) exact++
        checked++
      })
    }
    expect(checked).toBeGreaterThan(2000)
    expect(exact / checked).toBeGreaterThan(0.995)
  })
})
