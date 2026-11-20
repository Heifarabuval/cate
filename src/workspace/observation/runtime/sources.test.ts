import { describe, expect, it } from 'vitest'
import type { WorkspaceDocument } from '@workspace/document/contract'
import type { ObservationInput } from '../contract'
import { navigationFact, watchDocument } from './sources'
import { doc, fakeDocument, op, panel, relation } from './testing.test-helpers'

function watched(enabled = () => true) {
  const document = fakeDocument()
  const facts: ObservationInput[] = []
  const off = watchDocument(document.source, (fact) => { facts.push(fact) }, enabled)
  return { ...document, facts, off }
}

describe('the document as a source', () => {
  it('says a panel was created, with its type and its id only', () => {
    const w = watched()
    w.emit(op({ kind: 'addPanel' }), doc([]), doc([panel('p1', 'browser', 'Plan secret ABC-123')]))
    expect(w.facts).toEqual([{ kind: 'panel.created', panelType: 'browser', ref: 'p1' }])
    expect(JSON.stringify(w.facts)).not.toMatch(/Plan secret|ABC-123/)
  })

  it('says a panel was closed, by the type it had', () => {
    const w = watched()
    w.emit(op({ kind: 'removePanels' }), doc([panel('p1', 'terminal'), panel('p2', 'editor')]), doc([panel('p2', 'editor')]))
    expect(w.facts).toEqual([{ kind: 'panel.closed', panelType: 'terminal', ref: 'p1' }])
  })

  it('says every panel a closed window took with it', () => {
    const w = watched()
    w.emit(op({ kind: 'closeWindow' }), doc([panel('p1', 'terminal'), panel('p2', 'browser')]), doc([]))
    expect(w.facts).toEqual([
      { kind: 'panel.closed', panelType: 'terminal', ref: 'p1' },
      { kind: 'panel.closed', panelType: 'browser', ref: 'p2' },
    ])
  })

  it('says a panel was linked, by the type and the id of the panel it starts from', () => {
    const w = watched()
    const panels = [panel('b1', 'browser'), panel('t1', 'terminal')]
    w.emit(op({ kind: 'addRelation' }), doc(panels), doc(panels, [relation('r1', 'b1', 't1')]))
    expect(w.facts).toEqual([{ kind: 'panel.linked', panelType: 'browser', ref: 'b1' }])
  })

  it('says a created panel then its link, in the order of a batch', () => {
    const w = watched()
    const before = [panel('t1', 'terminal')]
    const after = [...before, panel('b1', 'browser')]
    w.emit(op({ kind: 'batch', changes: [{ kind: 'addPanel' }, { kind: 'addRelation' }] }), doc(before), doc(after, [relation('r1', 'b1', 't1')]))
    expect(w.facts.map((fact) => [fact.kind, fact.panelType, fact.ref])).toEqual([
      ['panel.created', 'browser', 'b1'],
      ['panel.linked', 'browser', 'b1'],
    ])
  })

  it('says a surface that becomes a type as a panel created, and says nothing of a surface itself', () => {
    const w = watched()
    w.emit(op({ kind: 'addPanel' }), doc([]), doc([panel('s1', 'surface')]))
    w.emit(op({ kind: 'replacePanel' }), doc([panel('s1', 'surface')]), doc([panel('s1', 'browser')]))
    w.emit(op({ kind: 'removePanels' }), doc([panel('s2', 'surface')]), doc([]))
    expect(w.facts).toEqual([{ kind: 'panel.created', panelType: 'browser', ref: 's1' }])
  })

  it('says nothing of a panel replaced by its own type', () => {
    const w = watched()
    w.emit(op({ kind: 'replacePanel' }), doc([panel('p1', 'browser')]), doc([panel('p1', 'browser')]))
    expect(w.facts).toEqual([])
  })

  it('does not read the document for an op that cannot create, close or link a panel', () => {
    const w = watched()
    const untouchable = new Proxy({} as WorkspaceDocument, { get: () => { throw new Error('the document was read') } })
    for (const kind of ['setNodeRects', 'setSplitRatio', 'updatePanel', 'placePanel', 'updateRelation', 'removeRelation', 'addFrame', 'setWorktree']) {
      expect(() => w.emit(op({ kind }), untouchable, untouchable), kind).not.toThrow()
    }
    expect(() => w.emit(op({ kind: 'batch', changes: [{ kind: 'setNodeRects' }, { kind: 'updatePanel' }] }), untouchable, untouchable)).not.toThrow()
    expect(w.facts).toEqual([])
  })

  it('does not read the document at all while the observation is off', () => {
    let on = false
    const w = watched(() => on)
    const untouchable = new Proxy({} as WorkspaceDocument, { get: () => { throw new Error('the document was read') } })
    expect(() => w.emit(op({ kind: 'addPanel' }), untouchable, untouchable)).not.toThrow()
    expect(w.facts).toEqual([])
    on = true
    w.emit(op({ kind: 'addPanel' }), doc([]), doc([panel('p1', 'browser')]))
    expect(w.facts).toHaveLength(1)
  })

  it('stops when it is switched off', () => {
    const w = watched()
    expect(w.listeners()).toBe(1)
    w.off()
    expect(w.listeners()).toBe(0)
  })
})

describe('a navigation as a source', () => {
  it('is a navigate fact of a browser panel with the address as it came', () => {
    expect(navigationFact('https://example.com/a?token=abc#x')).toEqual({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/a?token=abc#x' })
  })
})
