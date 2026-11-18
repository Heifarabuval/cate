import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { clientStateFor, documentStoreFor } from '@client/document'
import { FRAME_STATES, MAX_FRAME_TITLE, applyOp, type DocChange, type FrameState } from '@workspace/document/contract'
import { frameBounds, rect } from '@workspace/canvas/contract'
import { canvasDocument } from '../testing.canvas'
import { openTestDocument } from '../testing'
import { createCanvasView, type CanvasViewStore } from '../store'
import { CanvasViewProvider } from '../context'
import { FrameLayer } from './FrameLayer'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WS = 'ws-frames'
const LABELS: Record<FrameState, string> = { active: 'en cours', waiting: "t'attend", blocked: 'bloqué', done: 'fait' }
const nodes = [
  { nodeId: 'a', panelId: 'pa', rect: rect(100, 200, 400, 300) },
  { nodeId: 'b', panelId: 'pb', rect: rect(600, 200, 400, 300) },
  { nodeId: 'out', panelId: 'pout', rect: rect(1400, 200, 400, 300) },
]

let container: HTMLDivElement
let root: Root
let detach: () => void
let store: CanvasViewStore

function framed(state: FrameState = 'active', title = 'Besoin : couleurs', collapsed = false) {
  let doc = canvasDocument(nodes)
  const apply = (change: DocChange) => {
    const result = applyOp(doc, change)
    if (result.error) throw new Error(result.error.message)
    doc = result.doc
  }
  apply({ kind: 'addFrame', canvasId: 'c1', frame: { id: 'f1', title, state, collapsed, at: { x: 40, y: 60 } } })
  apply({ kind: 'setNodeFrame', canvasId: 'c1', nodeId: 'a', frameId: 'f1' })
  apply({ kind: 'setNodeFrame', canvasId: 'c1', nodeId: 'b', frameId: 'f1' })
  return doc
}

function open(doc = framed()) {
  detach = openTestDocument(WS, doc)
  store = createCanvasView({ workspaceId: WS, canvasId: 'c1', document: documentStoreFor(WS)!, clientState: clientStateFor(WS), animate: false })
  act(() => root.render(<CanvasViewProvider store={store}><FrameLayer workspaceId={WS} canvasId="c1" /></CanvasViewProvider>))
}

const frameEl = () => container.querySelector<HTMLElement>('[data-frame="f1"]')!
const box = (el: HTMLElement) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) })
const expected = (collapsed = false) => {
  const r = frameBounds([rect(100, 200, 400, 300), rect(600, 200, 400, 300)], { x: 40, y: 60 }, collapsed)
  return { left: r.origin.x, top: r.origin.y, width: r.size.width, height: r.size.height }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  detach?.()
})

describe('FrameLayer states', () => {
  it.each(FRAME_STATES)('shows %s with a label and an icon', (state) => {
    open(framed(state))
    const pill = container.querySelector<HTMLElement>(`[data-frame-state="${state}"]`)!
    expect(pill.textContent).toContain(LABELS[state])
    expect(pill.querySelector('svg')).not.toBeNull()
  })

  it('dims a done frame through its border and bar, never its text', () => {
    open(framed('done'))
    expect(frameEl().dataset.dim).toBe('true')
    expect(frameEl().className).toContain('border-subtle')
    expect(container.querySelector<HTMLElement>('[data-frame-title]')!.className).not.toMatch(/opacity/)
  })

  it('keeps the other states at full strength', () => {
    open(framed('waiting'))
    expect(frameEl().dataset.dim).toBeUndefined()
    expect(frameEl().className).toContain('border-strong')
  })
})

describe('FrameLayer geometry', () => {
  it('draws the bounds of its members', () => {
    open()
    expect(box(frameEl())).toEqual(expected())
  })

  it('follows a gesture preview of one member', () => {
    open()
    act(() => store.getState().moveNode('b', { x: 900, y: 500 }))
    const r = frameBounds([rect(100, 200, 400, 300), rect(900, 500, 400, 300)], { x: 40, y: 60 }, false)
    expect(box(frameEl())).toEqual({ left: r.origin.x, top: r.origin.y, width: r.size.width, height: r.size.height })
  })

  it('does not draw a frame around a node that is not a member', () => {
    open()
    expect(frameEl().style.width).not.toBe('')
    expect(box(frameEl()).left + box(frameEl()).width).toBeLessThan(1400)
  })

  it('draws no frame on a canvas without frames', () => {
    open(canvasDocument(nodes))
    expect(container.querySelector('[data-frame]')).toBeNull()
  })
})

describe('FrameLayer title', () => {
  it('cuts a long title on one line and keeps it whole in title', () => {
    const long = 'Besoin très long '.repeat(8).trim().slice(0, MAX_FRAME_TITLE)
    expect(long.length).toBe(MAX_FRAME_TITLE)
    open(framed('active', long))
    const title = container.querySelector<HTMLElement>('[data-frame-title]')!
    expect(title.title).toBe(long)
    expect(title.className).toContain('truncate')
  })

  it('counts the panels with an icon', () => {
    open()
    const count = container.querySelector<HTMLElement>('[data-frame-count]')!
    expect(count.textContent).toContain('2')
    expect(count.querySelector('svg')).not.toBeNull()
  })

  it('turns animation off under prefers-reduced-motion', () => {
    open()
    expect(frameEl().className).toContain('motion-reduce:transition-none')
    expect(container.querySelector<HTMLElement>('[data-frame-state]')!.className).toContain('motion-reduce:transition-none')
  })
})

describe('FrameLayer colors', () => {
  it.each(FRAME_STATES)('uses theme tokens only (%s)', (state) => {
    open(framed(state))
    const html = container.innerHTML
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(html).not.toMatch(/text-muted|text-white|text-black/)
    for (const el of container.querySelectorAll<HTMLElement>('button, input, [data-frame-title], [data-frame-state]')) {
      expect(el.className, el.outerHTML).toMatch(/text-(primary|secondary)/)
    }
  })
})
