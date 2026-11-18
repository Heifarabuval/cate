import { describe, expect, it } from 'vitest'
import { rect } from '@workspace/canvas/contract'
import { applyOp } from './apply'
import type { DocChange, PlaceTarget } from './ops'
import { createDocument, MAIN_WINDOW, type CanvasFrame, type PanelId, type PanelType, type WorkspaceDocument } from './schema'
import { findFrame, frameOfPanel, framePanels } from './selectors'

const R = rect(0, 0, 400, 300)
const NODE1 = { canvasId: 'canvas-cv', nodeId: 'n1' }
const frame = (id: string): CanvasFrame => ({ id, title: id, state: 'active', collapsed: false, at: { x: 0, y: 0 } })
const add = (id: string, type: PanelType, at: PlaceTarget): DocChange =>
  ({ kind: 'addPanel', record: { id, type, title: id, fields: {}, ...(type === 'canvas' ? { canvasId: `canvas-${id}` } : {}) }, at })
const onNode = (nodeId: string, stackId: string): PlaceTarget => ({ to: 'canvas', canvasId: 'canvas-cv', nodeId, stackId, rect: R })

/** Canvas `cv` with n1 [x terminal, t browser], n2 [e editor], n3 [r review];
 *  frame f1 holds n1 and n2, frame f2 holds nothing. */
function sample(): WorkspaceDocument {
  const result = applyOp(createDocument(), {
    kind: 'batch',
    changes: [
      add('cv', 'canvas', { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's1' }),
      add('x', 'terminal', onNode('n1', 'sn1')),
      add('t', 'browser', { to: 'stack', dock: NODE1, stackId: 'sn1' }),
      add('e', 'editor', onNode('n2', 'sn2')),
      add('r', 'review', onNode('n3', 'sn3')),
      { kind: 'addFrame', canvasId: 'canvas-cv', frame: frame('f1') },
      { kind: 'addFrame', canvasId: 'canvas-cv', frame: frame('f2') },
      { kind: 'setNodeFrame', canvasId: 'canvas-cv', nodeId: 'n1', frameId: 'f1' },
      { kind: 'setNodeFrame', canvasId: 'canvas-cv', nodeId: 'n2', frameId: 'f1' },
    ],
  })
  if (result.error) throw new Error(result.error.message)
  return result.doc
}

describe('frame selectors', () => {
  it('findFrame reads a frame by id, whatever its canvas', () => {
    const doc = sample()
    expect(findFrame(doc, 'f1')).toEqual(frame('f1'))
    expect(findFrame(doc, 'f2')).toEqual(frame('f2'))
    expect(findFrame(doc, 'nope')).toBeUndefined()
  })

  it('frameOfPanel is the same for a terminal, a browser, an editor and a review', () => {
    const doc = sample()
    const ids: PanelId[] = ['x', 't', 'e']
    expect(ids.map((id) => doc.panels[id].type)).toEqual(['terminal', 'browser', 'editor'])
    for (const id of ids) expect(frameOfPanel(doc, id)).toEqual(frame('f1'))
    expect(doc.panels.r.type).toBe('review')
    expect(frameOfPanel(doc, 'r')).toBeUndefined()
  })

  it('frameOfPanel is undefined for a panel in a window dock and for an unknown panel', () => {
    const doc = sample()
    expect(frameOfPanel(doc, 'cv')).toBeUndefined()
    expect(frameOfPanel(doc, 'nope')).toBeUndefined()
  })

  it('framePanels lists the tabs of every member node, node by node, and none for an empty or unknown frame', () => {
    const doc = sample()
    expect(framePanels(doc, 'f1')).toEqual(['x', 't', 'e'])
    expect(framePanels(doc, 'f2')).toEqual([])
    expect(framePanels(doc, 'nope')).toEqual([])
  })
})
