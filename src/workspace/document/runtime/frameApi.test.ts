import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { frameBounds, rect, rectsOverlap } from '@workspace/canvas/contract'
import { ApiRouter, ApiTokenRegistry } from '@kernel/api/runtime'
import {
  MAIN_WINDOW,
  frameOfPanel,
  framePanels,
  type CanvasFrame,
  type PanelType,
  type PlaceTarget,
} from '../contract'
import { canvasApi, frameApi, panelApi } from '../contract/api'
import { createDocumentService, registerDocumentApi, type DocumentService } from './index'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cate-frame-api-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const SIZE = { width: 400, height: 300 }
const inWindow = { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's0' } as const
const onCanvas = (canvasId: string, nodeId: string, x: number): PlaceTarget =>
  ({ to: 'canvas', canvasId, nodeId, stackId: `stack-${nodeId}`, rect: rect(x, 0, SIZE.width, SIZE.height) })

const file = () => path.join(dir, 'document.json')

function setup(type: PanelType = 'browser') {
  const document: DocumentService = createDocumentService({ file: file() })
  const put = (id: string, panelType: PanelType, at: PlaceTarget, canvasId?: string) =>
    document.apply({
      kind: 'addPanel',
      record: { id, type: panelType, title: id, fields: {}, ...(canvasId ? { canvasId } : {}) },
      at,
    })
  put('cv', 'canvas', inWindow, 'c1')
  put('cv2', 'canvas', inWindow, 'c2')
  put('docked', 'terminal', inWindow)
  put('term-aaaa', 'terminal', onCanvas('c1', 'n-caller', 0))
  put('panel-bbbb', type, onCanvas('c1', 'n-b', 1000))
  put('panel-cccc', type, onCanvas('c1', 'n-c', 1500))
  put('term-eeee', 'terminal', onCanvas('c1', 'n-tab', 2000))
  document.apply({
    kind: 'addPanel',
    record: { id: 'term-ffff', type: 'terminal', title: 'ffff', fields: {} },
    at: { to: 'stack', dock: { canvasId: 'c1', nodeId: 'n-tab' }, stackId: 'stack-n-tab' },
  })
  put('term-gggg', 'terminal', onCanvas('c2', 'n-other', 0))
  return wire(document)
}

/** A router, its API and a CLI caller on top of a document service. */
function wire(document: DocumentService) {
  const settings: Record<string, unknown> = { cliEnabled: true, cliPanelReadEnabled: true, cliPanelControlEnabled: true }
  const tokens = new ApiTokenRegistry(() => `tok-${Math.random()}`)
  const info = (id: string) => {
    const record = document.get().panels[id]
    return record ? { id, type: record.type } : undefined
  }
  const router = new ApiRouter({
    namespaces: [panelApi, canvasApi, frameApi],
    document: { panel: info, panels: () => Object.keys(document.get().panels).map((id) => info(id)!) },
    presence: { activePanelId: () => undefined },
    sessions: { handleApi: async () => null },
    settings: { get: (key) => settings[key] },
    tokens,
  })
  registerDocumentApi(router, {
    document,
    presence: { activePanelId: () => undefined },
    checkRemoval: () => {},
    createPanel: () => null,
    relationKinds: () => [],
  })
  const caller = tokens.issue({ kind: 'cli', panelId: 'term-aaaa' }).caller
  const dockedCaller = tokens.issue({ kind: 'cli', panelId: 'docked' }).caller
  const call = (method: string, args: Record<string, unknown> = {}, who = caller) =>
    router.call(who, `cate.frame.${method}`, args)
  const frames = (canvasId = 'c1'): CanvasFrame[] => Object.values(document.get().canvases[canvasId].frames ?? {})
  const create = async (title = 'Besoin', args: Record<string, unknown> = {}) =>
    (await call('create', { title, ...args })) as { frameId: string; canvasId: string }
  const originOf = (nodeId: string, canvasId = 'c1') => document.get().canvases[canvasId].nodes[nodeId].rect.origin
  return { document, settings, call, create, frames, originOf, caller, dockedCaller }
}

describe('frame.create', () => {
  it('refuses a missing or blank title', async () => {
    const { call, frames } = setup()
    await expect(call('create', {})).rejects.toMatchObject({ code: 'rejected' })
    await expect(call('create', { title: '   ' })).rejects.toMatchObject({ code: 'rejected' })
    expect(frames()).toEqual([])
  })

  it('makes an active, expanded frame next to the caller, on its canvas', async () => {
    const { create, frames } = setup()
    const { frameId, canvasId } = await create('#n3 cadrage')
    expect(canvasId).toBe('c1')
    expect(frames()).toEqual([
      { id: frameId, title: '#n3 cadrage', state: 'active', collapsed: false, at: { x: 0, y: 340 } },
    ])
  })

  it('does not stack two new frames on the same spot', async () => {
    const { create, frames } = setup()
    await create('un')
    await create('deux')
    const [a, b] = frames()
    expect(a.at).not.toEqual(b.at)
  })

  it('needs --canvas when the caller is not on a canvas', async () => {
    const { call, create, frames, dockedCaller } = setup()
    await expect(call('create', { title: 'x' }, dockedCaller)).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('--canvas'),
    })
    const { canvasId } = (await call('create', { title: 'x', canvas: 'cv' }, dockedCaller)) as { canvasId: string }
    expect(canvasId).toBe('c1')
    expect(frames()).toHaveLength(1)
  })

  it('refuses a title over 120 characters and a 201st frame', async () => {
    const { call, create, frames } = setup()
    await expect(call('create', { title: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'rejected' })
    for (let i = 0; i < 200; i++) await create(`f${i}`)
    await expect(call('create', { title: 'one more' })).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('200'),
    })
    expect(frames()).toHaveLength(200)
  })
})

describe('frame.add', () => {
  it('puts the panel in the frame and on its first free place', async () => {
    const { call, create, document, originOf } = setup()
    const { frameId } = await create()
    const result = await call('add', { frameId, panelId: 'panel-bbbb' })
    expect(result).toEqual({ frameId, panelId: 'panel-bbbb', nodeId: 'n-b', moved: true })
    expect(originOf('n-b')).toEqual({ x: 20, y: 400 })
    expect(frameOfPanel(document.get(), 'panel-bbbb')?.id).toBe(frameId)
    await call('add', { frameId, panelId: 'panel-cccc' })
    expect(originOf('n-c')).toEqual({ x: 440, y: 400 })
  })

  it.each(['terminal', 'browser', 'editor', 'review'] as const)('treats a %s panel like any other', async (type) => {
    const { call, create, originOf } = setup(type)
    const { frameId } = await create()
    expect(await call('add', { frameId, panelId: 'panel-bbbb' })).toMatchObject({ moved: true })
    expect(originOf('n-b')).toEqual({ x: 20, y: 400 })
  })

  it('does nothing the second time', async () => {
    const { call, create, document } = setup()
    const { frameId } = await create()
    await call('add', { frameId, panelId: 'panel-bbbb' })
    const seq = document.seq
    expect(await call('add', { frameId, panelId: 'panel-bbbb' })).toMatchObject({ moved: false, nodeId: 'n-b' })
    expect(document.seq).toBe(seq)
  })

  it('moves a panel from one frame to another', async () => {
    const { call, create, document } = setup()
    const first = await create('un')
    const second = await create('deux')
    await call('add', { frameId: first.frameId, panelId: 'panel-bbbb' })
    expect(await call('add', { frameId: second.frameId, panelId: 'panel-bbbb' })).toMatchObject({ moved: true })
    expect(framePanels(document.get(), first.frameId)).toEqual([])
    expect(framePanels(document.get(), second.frameId)).toEqual(['panel-bbbb'])
  })

  it('refuses a docked panel, a panel of another canvas and a canvas panel, and changes nothing', async () => {
    const { call, create, document } = setup()
    const { frameId } = await create()
    const seq = document.seq
    await expect(call('add', { frameId, panelId: 'docked' })).rejects.toMatchObject({ code: 'rejected', message: expect.stringContaining('window') })
    await expect(call('add', { frameId, panelId: 'term-gggg' })).rejects.toMatchObject({ code: 'rejected', message: expect.stringContaining('canvas') })
    await expect(call('add', { frameId, panelId: 'cv2' })).rejects.toMatchObject({ code: 'rejected', message: expect.stringContaining('canvas') })
    expect(document.seq).toBe(seq)
  })

  it('takes the whole tab stack of the panel', async () => {
    const { call, create, document } = setup()
    const { frameId } = await create()
    expect(await call('add', { frameId, panelId: 'term-ffff' })).toMatchObject({ nodeId: 'n-tab', moved: true })
    expect(framePanels(document.get(), frameId).sort()).toEqual(['term-eeee', 'term-ffff'])
  })

  it('files into a collapsed frame without opening it, on the same place as an open one', async () => {
    const open = setup()
    const openFrame = await open.create()
    await open.call('add', { frameId: openFrame.frameId, panelId: 'panel-bbbb' })

    const shut = setup()
    const shutFrame = await shut.create()
    shut.document.apply({ kind: 'updateFrame', id: shutFrame.frameId, patch: { collapsed: true } })
    await shut.call('add', { frameId: shutFrame.frameId, panelId: 'panel-bbbb' })

    expect(shut.originOf('n-b')).toEqual(open.originOf('n-b'))
    expect(shut.frames()[0].collapsed).toBe(true)
  })

  it('names the frames when the reference matches none or several', async () => {
    const { call, document } = setup()
    for (const id of ['frame-aaa1', 'frame-aaa2']) {
      document.apply({ kind: 'addFrame', canvasId: 'c1', frame: { id, title: id, state: 'active', collapsed: false, at: { x: 0, y: 0 } } })
    }
    await expect(call('add', { frameId: 'zzz', panelId: 'panel-bbbb' })).rejects.toMatchObject({
      code: 'gone',
      message: expect.stringMatching(/frame-aaa1.*frame-aaa2/),
    })
    await expect(call('add', { frameId: 'frame-aaa', panelId: 'panel-bbbb' })).rejects.toMatchObject({
      code: 'gone',
      message: expect.stringMatching(/frame-aaa1.*frame-aaa2/),
    })
    expect(await call('add', { frameId: 'frame-aaa1', panelId: 'panel-bbbb' })).toMatchObject({ frameId: 'frame-aaa1' })
    expect(await call('add', { frameId: 'frame-aaa2', panelId: 'panel-cccc' })).toMatchObject({ frameId: 'frame-aaa2' })
  })

  it('refuses when the panel control setting is off', async () => {
    const { call, create, settings, document, frames } = setup()
    const { frameId } = await create()
    settings.cliPanelControlEnabled = false
    const seq = document.seq
    await expect(call('create', { title: 'x' })).rejects.toMatchObject({ message: expect.stringContaining('panel-control-disabled') })
    await expect(call('add', { frameId, panelId: 'panel-bbbb' })).rejects.toMatchObject({ message: expect.stringContaining('panel-control-disabled') })
    expect(document.seq).toBe(seq)
    expect(frames()).toHaveLength(1)
  })
})

describe('frame.state', () => {
  it.each(['active', 'waiting', 'blocked', 'done'] as const)('sets %s', async (state) => {
    const { call, create, frames } = setup()
    const { frameId } = await create()
    expect(await call('state', { frameId: frameId.slice(0, 8), state })).toEqual({ frameId, state })
    expect(frames()[0].state).toBe(state)
  })

  it('refuses another word, lists the four and sends nothing', async () => {
    const { call, create, document, frames } = setup()
    const { frameId } = await create()
    const seq = document.seq
    await expect(call('state', { frameId, state: 'nope' })).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringMatching(/active.*waiting.*blocked.*done/),
    })
    expect(document.seq).toBe(seq)
    expect(frames()[0].state).toBe('active')
  })
})

describe('frame.collapse and frame.expand', () => {
  it('anchors the title bar where the members\' frame was, and folds', async () => {
    const { call, create, document, frames } = setup()
    const { frameId } = await create()
    await call('add', { frameId, panelId: 'panel-bbbb' })
    document.apply({ kind: 'setNodeRects', canvasId: 'c1', rects: [{ nodeId: 'n-b', rect: rect(600, 700, 400, 300) }] })
    expect(await call('collapse', { frameId })).toEqual({ frameId, collapsed: true })
    expect(frames()[0]).toMatchObject({ collapsed: true, at: { x: 580, y: 640 } })
    expect(await call('expand', { frameId })).toEqual({ frameId, collapsed: false })
    expect(frames()[0]).toMatchObject({ collapsed: false, at: { x: 580, y: 640 } })
  })

  it('keeps the anchor of a frame without members', async () => {
    const { call, create, frames } = setup()
    const { frameId } = await create()
    const { at } = frames()[0]
    await call('collapse', { frameId })
    expect(frames()[0]).toMatchObject({ collapsed: true, at })
  })

  it('leaves a done frame folded, and still files panels into it in place', async () => {
    const open = setup()
    const openFrame = await open.create()
    await open.call('add', { frameId: openFrame.frameId, panelId: 'panel-bbbb' })

    const { call, create, frames, originOf } = setup()
    const { frameId } = await create()
    await call('collapse', { frameId })
    await call('state', { frameId, state: 'done' })
    await call('add', { frameId, panelId: 'panel-bbbb' })
    expect(frames()[0]).toMatchObject({ collapsed: true, state: 'done' })
    expect(originOf('n-b')).toEqual(open.originOf('n-b'))
  })
})

describe('frame.remove', () => {
  it('takes the panel out of its frame and keeps the empty frame', async () => {
    const { call, create, document, frames } = setup()
    const { frameId } = await create()
    await call('add', { frameId, panelId: 'panel-bbbb' })
    expect(await call('remove', { panelId: 'panel-bbbb' })).toEqual({ frameId, panelId: 'panel-bbbb' })
    expect(frameOfPanel(document.get(), 'panel-bbbb')).toBeUndefined()
    expect(frames()).toHaveLength(1)
  })

  it('does nothing for a panel that is in no frame', async () => {
    const { call, document } = setup()
    const seq = document.seq
    expect(await call('remove', { panelId: 'panel-bbbb' })).toEqual({ frameId: null, panelId: 'panel-bbbb' })
    expect(await call('remove', { panelId: 'docked' })).toEqual({ frameId: null, panelId: 'docked' })
    expect(document.seq).toBe(seq)
  })
})

describe('frame.delete', () => {
  it('dissolves the frame with one removeFrame and closes no panel', async () => {
    const { call, create, document, frames } = setup()
    const { frameId } = await create()
    await call('add', { frameId, panelId: 'panel-bbbb' })
    await call('add', { frameId, panelId: 'term-ffff' })
    const sent: string[] = []
    document.subscribe((event) => sent.push(event.op.kind))
    const panels = Object.keys(document.get().panels)
    const result = (await call('delete', { frameId })) as { frameId: string; panelIds: string[] }
    expect(sent).toEqual(['removeFrame'])
    expect(result.frameId).toBe(frameId)
    expect(result.panelIds.sort()).toEqual(['panel-bbbb', 'term-eeee', 'term-ffff'])
    expect(Object.keys(document.get().panels)).toEqual(panels)
    expect(frames()).toEqual([])
    expect(frameOfPanel(document.get(), 'panel-bbbb')).toBeUndefined()
  })
})

describe('frame.list', () => {
  it('lists every frame of the document with the contract fields', async () => {
    const { call, create } = setup()
    const first = await create('un')
    const second = await create('deux', { canvas: 'cv2' })
    await call('add', { frameId: first.frameId, panelId: 'panel-bbbb' })
    await call('state', { frameId: second.frameId, state: 'blocked' })
    const rows = (await call('list')) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        { frameId: first.frameId, canvasId: 'c1', title: 'un', state: 'active', collapsed: false, panelIds: ['panel-bbbb'] },
        { frameId: second.frameId, canvasId: 'c2', title: 'deux', state: 'blocked', collapsed: false, panelIds: [] },
      ]),
    )
  })

  it('reads the same rows after the runtime restarts, with no duplicate', async () => {
    const { call, create, document } = setup()
    const { frameId } = await create('persistant')
    await call('add', { frameId, panelId: 'panel-bbbb' })
    const before = await call('list')
    await document.flush()
    document.dispose()
    const again = wire(createDocumentService({ file: file() }))
    expect(await again.call('list')).toEqual(before)
    expect(await again.call('list')).toHaveLength(1)
    again.document.dispose()
  })

  it('needs only the read setting', async () => {
    const { call, settings } = setup()
    settings.cliPanelControlEnabled = false
    expect(await call('list')).toEqual([])
    settings.cliPanelReadEnabled = false
    await expect(call('list')).rejects.toMatchObject({ message: expect.stringContaining('panel-read-disabled') })
  })
})

describe('frames never overlap', () => {
  /** `count` more terminals, each on its own node far below the frames. */
  const more = (document: DocumentService, count: number): string[] =>
    Array.from({ length: count }, (_, i) => {
      const id = `x${i}`
      document.apply({
        kind: 'addPanel',
        record: { id, type: 'terminal', title: id, fields: {} },
        at: onCanvas('c1', `n-${id}`, 3000 + i * 500),
      })
      return id
    })

  it('keeps three frames of 1, 3 and 8 panels, and their title bars, apart', async () => {
    const { call, create, document, frames } = setup()
    const ids = more(document, 12)
    const [a, b, c] = [await create('un'), await create('trois'), await create('huit')]
    const fill = async (frameId: string, panels: string[]) => {
      for (const panelId of panels) await call('add', { frameId, panelId })
    }
    // Interleaved, the way two agents work at the same time.
    await fill(a.frameId, ids.slice(0, 1))
    await fill(b.frameId, ids.slice(1, 3))
    await fill(c.frameId, ids.slice(4, 8))
    await fill(b.frameId, ids.slice(3, 4))
    await fill(c.frameId, ids.slice(8, 12))

    const doc = document.get()
    const bounds = frames().map((frame) => ({
      title: frame.title,
      rect: frameBounds(
        Object.values(doc.canvases.c1.nodes).filter((node) => node.frameId === frame.id).map((node) => node.rect),
        frame.at,
        frame.collapsed,
      ),
    }))
    expect([a, b, c].map((f) => framePanels(doc, f.frameId).length)).toEqual([1, 3, 8])
    for (const [i, one] of bounds.entries()) {
      for (const other of bounds.slice(i + 1)) expect(rectsOverlap(one.rect, other.rect), `${one.title} / ${other.title}`).toBe(false)
    }
    // A frame made afterwards starts clear of every frame, bars included.
    const { frameId } = await create('quatre')
    const bar = frames().find((frame) => frame.id === frameId)!
    for (const other of bounds) expect(rectsOverlap(frameBounds([], bar.at, false), other.rect)).toBe(false)
  })
})

describe('concurrent calls (R4)', () => {
  it('gives 3 simultaneous adds 3 distinct places', async () => {
    const { call, create, originOf } = setup()
    const { frameId } = await create()
    const added = await Promise.all(['panel-bbbb', 'panel-cccc', 'term-eeee'].map((panelId) => call('add', { frameId, panelId })))
    expect(added.every((result) => (result as { moved: boolean }).moved)).toBe(true)
    const origins = ['n-b', 'n-c', 'n-tab'].map((node) => originOf(node))
    expect(new Set(origins.map((o) => `${o.x},${o.y}`)).size).toBe(3)
  })

  it('gives 3 simultaneous creates 3 distinct origins', async () => {
    const { call, frames } = setup()
    await Promise.all(['a', 'b', 'c'].map((title) => call('create', { title })))
    expect(new Set(frames().map((frame) => `${frame.at.x},${frame.at.y}`)).size).toBe(3)
  })
})

describe('frame.create --canvas', () => {
  it('wins over the caller\'s canvas, with a canvas panel or a panel on a canvas', async () => {
    const { call } = setup()
    expect(await call('create', { title: 'a', canvas: 'cv2' })).toMatchObject({ canvasId: 'c2' })
    expect(await call('create', { title: 'b', canvas: 'term-gggg' })).toMatchObject({ canvasId: 'c2' })
    expect(await call('create', { title: 'c', canvas: 'cv' })).toMatchObject({ canvasId: 'c1' })
  })

  it('refuses a panel that is on no canvas', async () => {
    const { call, frames } = setup()
    await expect(call('create', { title: 'x', canvas: 'docked' })).rejects.toMatchObject({ code: 'rejected' })
    expect(frames()).toEqual([])
  })
})

describe('frame titles', () => {
  it.each(['\x1b[31mred', 'a\tb', 'a\x7fb', 'a\u0085b', 'a‮b'])('refuses %j from the CLI and from an op', async (title) => {
    const { call, create, document, frames } = setup()
    await expect(call('create', { title })).rejects.toMatchObject({ code: 'rejected' })
    const { frameId } = await create('ok')
    const op = { opId: { clientId: 'x', counter: 1 } }
    expect(document.submit({ ...op, kind: 'updateFrame', id: frameId, patch: { title } })).toMatchObject({ status: 'failed' })
    expect(document.submit({ opId: { clientId: 'x', counter: 2 }, kind: 'addFrame', canvasId: 'c1', frame: { id: 'f9', title, state: 'active', collapsed: false, at: { x: 0, y: 0 } } })).toMatchObject({ status: 'failed' })
    expect(frames().map((f) => f.title)).toEqual(['ok'])
  })
})
