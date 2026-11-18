import { afterEach, describe, expect, it, vi } from 'vitest'
import { rect } from '@workspace/canvas/contract'
import { applyOp } from '@workspace/document/contract'
import { installClientUi } from '@kernel/interaction'
import type { ClientUi } from '@kernel/interaction/contract'
import { registerPanelDefinitions } from '@client/host'
import { setHoveredFrame } from '../../client/layout/canvas/frame/target'
import { canvasViewFor, resetCanvasViews } from '../../client/layout/canvas'
import { canvasDocument } from '../../client/layout/canvas/testing.canvas'
import { attachTestWorkspace, testPanelDefinitions, type TestWorkspace } from '../../../../../test/clientWorkspace'
import { useUIStore } from '../state/uiStore'
import { CANVAS_ACTIONS, canvasActionBindings, handleCanvasKey } from './canvas'
import { keyContext } from './useShortcuts'

registerPanelDefinitions(testPanelDefinitions().map((d) => (d.type === 'terminal' ? { ...d, ownsKeyboard: true } : d)))

const del = () => new KeyboardEvent('keydown', { key: 'Delete' })

let ws: TestWorkspace | null = null
afterEach(() => {
  resetCanvasViews()
  ws?.detach()
  ws = null
  useUIStore.setState({ selectedWorkspaceId: null })
})

function setup() {
  ws = attachTestWorkspace('ws', canvasDocument([
    { nodeId: 'a', panelId: 'pa', rect: rect(0, 0, 400, 300) },
    { nodeId: 'b', panelId: 'pb', rect: rect(500, 0, 400, 300) },
  ]))
  useUIStore.setState({ selectedWorkspaceId: 'ws' })
  const store = canvasViewFor('ws', 'c1')!
  const deleteSelection = vi.fn(async () => {})
  store.setState({ deleteSelection })
  return { store, deleteSelection }
}

describe('canvas keys', () => {
  it('Delete closes a multi-selection made after a shell was focused', () => {
    const { store, deleteSelection } = setup()
    store.getState().focusNode('a')
    store.getState().selectNodes(['b'], true)
    expect(keyContext().keyboardOwned).toBe(false)
    expect(handleCanvasKey(del(), keyContext())).toBe(true)
    expect(deleteSelection).toHaveBeenCalledOnce()
  })

  it('a focused shell keeps Delete', () => {
    const { store, deleteSelection } = setup()
    store.getState().focusNode('a')
    expect(keyContext().keyboardOwned).toBe(true)
    expect(handleCanvasKey(del(), keyContext())).toBe(false)
    expect(deleteSelection).not.toHaveBeenCalled()
  })
})

describe('frame actions', () => {
  const ids = ['frame.collapse', 'frame.expand', 'frame.rename', 'frame.dissolve'] as const

  function setupFrame(collapsed = false) {
    let doc = canvasDocument([
      { nodeId: 'a', panelId: 'pa', rect: rect(0, 0, 400, 300) },
      { nodeId: 'b', panelId: 'pb', rect: rect(500, 0, 400, 300) }
    ])
    for (const change of [
      { kind: 'addFrame', canvasId: 'c1', frame: { id: 'f1', title: 'Besoin', state: 'active', collapsed, at: { x: 0, y: 0 } } },
      { kind: 'setNodeFrame', canvasId: 'c1', nodeId: 'a', frameId: 'f1' }
    ] as const) {
      const result = applyOp(doc, change)
      if (result.error) throw new Error(result.error.message)
      doc = result.doc
    }
    ws = attachTestWorkspace('ws', doc)
    useUIStore.setState({ selectedWorkspaceId: 'ws' })
    const store = canvasViewFor('ws', 'c1')!
    const propose = vi.spyOn(ws.document, 'propose')
    const confirm = vi.fn(async () => true)
    const promptText = vi.fn(async (_: { message: string; initial: string }): Promise<string | null> => 'Nouveau titre')
    installClientUi({ confirm, promptText } as unknown as ClientUi)
    const bindings = canvasActionBindings()
    const frame = () => ws!.document.getSnapshot().canvases.c1.frames!.f1
    return { store, propose, confirm, promptText, bindings, frame, context: { workspaceId: 'ws', canvasId: 'c1' } }
  }

  afterEach(() => setHoveredFrame(null))

  it('declares the four actions once', () => {
    for (const id of ids) expect(CANVAS_ACTIONS[id].title).toBeTruthy()
  })

  it('targets the frame under the pointer, else the frame of the selected node', async () => {
    const { store, bindings, frame, context } = setupFrame()
    expect(bindings['frame.collapse'].enabled?.(context)).toBe(false)
    store.getState().focusNode('a')
    expect(bindings['frame.collapse'].enabled?.(context)).toBe(true)
    store.getState().focusNode('b')
    expect(bindings['frame.collapse'].enabled?.(context)).toBe(false)
    setHoveredFrame({ workspaceId: 'ws', canvasId: 'c1', frameId: 'f1' })
    expect(bindings['frame.collapse'].enabled?.(context)).toBe(true)
    await bindings['frame.collapse'].run(context)
    expect(frame().collapsed).toBe(true)
  })

  it('collapses and expands with one updateFrame each, no panel touched', async () => {
    const { store, bindings, propose, frame, context } = setupFrame()
    store.getState().focusNode('a')
    const panels = ws!.document.getSnapshot().panels
    await bindings['frame.collapse'].run(context)
    await bindings['frame.expand'].run(context)
    expect(propose.mock.calls.map(([change]) => change.kind)).toEqual(['updateFrame', 'updateFrame'])
    expect(frame().collapsed).toBe(false)
    expect(ws!.document.getSnapshot().panels).toBe(panels)
  })

  it('offers collapse on an open frame and expand on a collapsed one', () => {
    const open = setupFrame()
    open.store.getState().focusNode('a')
    expect(open.bindings['frame.collapse'].enabled?.(open.context)).toBe(true)
    expect(open.bindings['frame.expand'].enabled?.(open.context)).toBe(false)
    ws?.detach()
    resetCanvasViews()
    const closed = setupFrame(true)
    closed.store.getState().focusNode('a')
    expect(closed.bindings['frame.collapse'].enabled?.(closed.context)).toBe(false)
    expect(closed.bindings['frame.expand'].enabled?.(closed.context)).toBe(true)
  })

  it('renames through ClientUi with one updateFrame', async () => {
    const { store, bindings, propose, promptText, frame, context } = setupFrame()
    store.getState().focusNode('a')
    await bindings['frame.rename'].run(context)
    expect(promptText).toHaveBeenCalledWith(expect.objectContaining({ initial: 'Besoin' }))
    expect(propose).toHaveBeenCalledTimes(1)
    expect(propose).toHaveBeenCalledWith({ kind: 'updateFrame', id: 'f1', patch: { title: 'Nouveau titre' } })
    expect(frame().title).toBe('Nouveau titre')
  })

  it('keeps the title when the prompt is cancelled, empty or unchanged', async () => {
    const { store, bindings, propose, promptText, context } = setupFrame()
    store.getState().focusNode('a')
    for (const answer of [null, '   ', 'Besoin']) {
      promptText.mockResolvedValueOnce(answer)
      await bindings['frame.rename'].run(context)
    }
    expect(propose).not.toHaveBeenCalled()
  })

  it('dissolves without a confirmation and sends removeFrame only', async () => {
    const { store, bindings, propose, confirm, context } = setupFrame()
    store.getState().focusNode('a')
    const panels = ws!.document.getSnapshot().panels
    await bindings['frame.dissolve'].run(context)
    expect(confirm).not.toHaveBeenCalled()
    expect(propose.mock.calls.map(([change]) => change)).toEqual([{ kind: 'removeFrame', id: 'f1' }])
    const doc = ws!.document.getSnapshot()
    expect(doc.canvases.c1.frames?.f1).toBeUndefined()
    expect(doc.canvases.c1.nodes.a.frameId).toBeUndefined()
    expect(doc.panels).toBe(panels)
  })
})
