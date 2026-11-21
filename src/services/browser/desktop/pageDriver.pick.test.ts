import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { setupGuest } from './pageDriver.testSupport'

/** Runs the in-page function the driver sends on a stand-in element. */
function runInPage(fn: string, element: unknown): unknown {
  return (new Function(`return (${fn})`)() as (this: unknown) => unknown).call(element)
}

function fakeElement(tagName: string, extra: Record<string, unknown> = {}) {
  const parent = { nodeType: 1, tagName: 'FORM', id: 'login', parentElement: null, children: [] as unknown[] }
  const element = {
    nodeType: 1, tagName, id: '', parentElement: parent, isContentEditable: false,
    innerText: '', textContent: '', getBoundingClientRect: () => ({ x: 10, y: 20, width: 30, height: 40 }),
    ...extra,
  }
  parent.children.push(element)
  return element
}

async function pickingGuest(element: unknown) {
  const calls: string[] = []
  const setup = await setupGuest(async (method, params) => {
    calls.push(method)
    if (method === 'Accessibility.getPartialAXTree') return { nodes: [{ role: { value: 'textbox' } }] }
    if (method === 'Runtime.callFunctionOn') return { result: { value: runInPage(String(params.functionDeclaration), element) } }
    return undefined
  })
  return { ...setup, calls }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

it('waits for the person to click, then sends only the selector, role, text and box', async () => {
  const field = fakeElement('INPUT', { value: 'hunter2', innerText: '', textContent: '' })
  const { execute, events, calls, contents } = await pickingGuest(field)
  const picking = execute('pickElement')
  await tick()
  expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Overlay.setInspectMode', expect.objectContaining({ mode: 'searchForNode' }), undefined)
  expect(calls).not.toContain('Runtime.callFunctionOn')

  events.emit('message', {}, 'Overlay.inspectNodeRequested', { backendNodeId: 9 })
  const { result } = await picking
  expect(result).toEqual({ selector: '#login > input', role: 'textbox', text: '', rect: { x: 10, y: 20, width: 30, height: 40 } })
  expect(JSON.stringify(result)).not.toContain('hunter2')
  expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Overlay.setInspectMode', expect.objectContaining({ mode: 'none' }), undefined)
})

it('sends the text of an element that is not a field', async () => {
  const { execute, events } = await pickingGuest(fakeElement('BUTTON', { innerText: 'Save' }))
  const picking = execute('pickElement')
  await tick()
  events.emit('message', {}, 'Overlay.inspectNodeRequested', { backendNodeId: 7 })
  expect((await picking).result).toMatchObject({ selector: '#login > button', text: 'Save' })
})

it('sends nothing when the person cancels', async () => {
  const { execute, events, calls } = await pickingGuest(fakeElement('BUTTON'))
  const picking = execute('pickElement')
  await tick()
  events.emit('message', {}, 'Overlay.inspectModeCanceled', {})
  expect(await picking).toEqual({ result: null })
  expect(calls).not.toContain('Runtime.callFunctionOn')
})

it('lets agent commands run while the person picks', async () => {
  const { execute, events } = await pickingGuest(fakeElement('BUTTON'))
  const picking = execute('pickElement')
  await tick()
  expect((await execute('getAttribute', { target: [5, 5], attribute: 'href' })).error).not.toBe('browser-pick-pending')
  events.emit('message', {}, 'Overlay.inspectModeCanceled', {})
  await picking
})

it('ends a pick the person stops from the panel, and a new pick replaces the pending one', async () => {
  const { execute } = await pickingGuest(fakeElement('BUTTON'))
  const first = execute('pickElement')
  await tick()
  const second = execute('pickElement')
  expect(await first).toEqual({ result: null })
  await tick()
  expect(await execute('cancelPick')).toEqual({ result: null })
  expect(await second).toEqual({ result: null })
})

it('never reads the source of a script or style, nor falls back to textContent', async () => {
  for (const element of [
    fakeElement('DIV', { innerText: '', textContent: 'const token = "abc123"' }),
    fakeElement('SCRIPT', { innerText: 'const token = "abc123"', textContent: 'const token = "abc123"' }),
    fakeElement('STYLE', { innerText: '.a{}', textContent: '.a{}' }),
  ]) {
    const { execute, events } = await pickingGuest(element)
    const picking = execute('pickElement')
    await tick()
    events.emit('message', {}, 'Overlay.inspectNodeRequested', { backendNodeId: 7 })
    expect((await picking).result).toMatchObject({ text: '' })
  }
})

it('ends a pending pick when the page navigates or the debugger lets go', async () => {
  const navigating = await pickingGuest(fakeElement('BUTTON'))
  const first = navigating.execute('pickElement')
  await tick()
  navigating.events.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', url: 'https://other.test/' } })
  expect(await first).toEqual({ result: null })

  const detaching = await pickingGuest(fakeElement('BUTTON'))
  const second = detaching.execute('pickElement')
  await tick()
  detaching.events.emit('detach', {}, 'target closed')
  expect(await second).toEqual({ result: null })
  expect(detaching.calls.filter((method) => method === 'Overlay.setInspectMode')).toHaveLength(1)
})
