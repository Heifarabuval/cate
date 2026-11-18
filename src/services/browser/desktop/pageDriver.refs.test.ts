import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { setupGuest } from './pageDriver.testSupport'

/** The element refs one guest's driver keeps (main-process memory). */
const retainedRefs = (runtime: unknown) => {
  const driver = (runtime as { drivers: Map<number, { refs: Map<number, unknown>; stableIds: Map<string, number> }> }).drivers.get(80)!
  return { refs: driver.refs.size, stableIds: driver.stableIds.size }
}

it('keeps element refs bounded on a page that replaces its nodes without navigating', async () => {
  const { runtime, observe, execute, state } = await setupGuest()
  const PER_READ = 300
  let next = 1_000
  const replaceNodes = () => {
    state.nodes = Array.from({ length: PER_READ }, () => ({ backendDOMNodeId: next++, role: { value: 'button' }, name: { value: `Item ${next}` } }))
  }
  let first: Awaited<ReturnType<typeof observe>> | undefined
  let latest: Awaited<ReturnType<typeof observe>> | undefined
  for (let read = 0; read < 50; read++) {
    replaceNodes()
    latest = await observe()
    first ??= latest
  }
  // Only the refs of the last two reads remain, not 50 reads' worth.
  expect(retainedRefs(runtime)).toEqual({ refs: 2 * PER_READ, stableIds: 2 * PER_READ })
  // An element the page no longer shows is stale; the latest one still acts.
  expect(await execute('click', { target: first!.elements[0].id })).toMatchObject({ error: 'stale-browser-element' })
  expect(await execute('click', { observationId: latest!.observationId, target: latest!.elements[0].id })).toHaveProperty('result')
})

it('keeps the id of an element that every read still shows', async () => {
  const { observe, state } = await setupGuest()
  const stay = { backendDOMNodeId: 7, role: { value: 'button' }, name: { value: 'Save' } }
  let next = 1_000
  const ids = new Set<number>()
  for (let read = 0; read < 5; read++) {
    state.nodes = [stay, { backendDOMNodeId: next++, role: { value: 'button' }, name: { value: `Item ${next}` } }]
    ids.add((await observe()).elements.find(element => element.name === 'Save')!.id)
  }
  expect(ids.size).toBe(1)
})

it('keeps the ids of the last snapshot shown valid until the next one, then reports them stale', async () => {
  let next = 1_000
  let changing = false
  const { observe, execute, state } = await setupGuest(async method => {
    // Every tree read sees a page that replaced its nodes.
    if (method === 'Page.getFrameTree' && changing) state.nodes = [{ backendDOMNodeId: next++, role: { value: 'button' }, name: { value: `Item ${next}` } }]
    return undefined
  })
  state.nodes = [{ backendDOMNodeId: 500, role: { value: 'button' }, name: { value: 'Old' } }]
  const shown = await observe()
  const old = shown.elements[0].id
  changing = true
  // A failing command reads the tree many times and shows the agent nothing.
  expect(await execute('waitFor', { name: 'Never', timeoutMs: 600 })).toMatchObject({ error: 'browser-wait-timeout' })
  expect(await execute('click', { observationId: shown.observationId, target: old })).toHaveProperty('result')
  // Two snapshots later, the element no read shows any more is stale, with a hint.
  await observe()
  expect(await execute('click', { observationId: shown.observationId, target: old })).toMatchObject({
    error: 'stale-browser-element', recovery: expect.stringContaining('Observe again'),
  })
})

it('keeps refs bounded across failing commands and keeps the shown snapshot usable', async () => {
  let next = 1_000
  let changing = false
  const { runtime, observe, execute, state } = await setupGuest(async method => {
    if (method === 'Page.getFrameTree' && changing) state.nodes = [{ backendDOMNodeId: next++, role: { value: 'button' }, name: { value: `Item ${next}` } }]
    return undefined
  })
  state.nodes = [{ backendDOMNodeId: 500, role: { value: 'button' }, name: { value: 'Old' } }]
  const shown = await observe()
  changing = true
  for (let attempt = 0; attempt < 8; attempt++) {
    expect(await execute('waitFor', { name: 'Never', timeoutMs: 1 })).toMatchObject({ error: 'browser-wait-timeout' })
  }
  // Only the element of the last snapshot shown survives; the failures' reads are forgotten.
  expect(retainedRefs(runtime)).toEqual({ refs: 1, stableIds: 1 })
  expect(await execute('click', { observationId: shown.observationId, target: shown.elements[0].id })).toHaveProperty('result')
})

it.each([
  { later: 1, outcome: { result: expect.anything() } },
  { later: 2, outcome: { error: 'stale-browser-element' } }
])('an id is valid after $later more snapshot(s) that no longer list it only if $later is 1', async ({ later, outcome }) => {
  const { observe, execute, state } = await setupGuest()
  state.nodes = [{ backendDOMNodeId: 500, role: { value: 'button' }, name: { value: 'Old' } }]
  const first = await observe()
  for (let snapshot = 0; snapshot < later; snapshot++) {
    state.nodes = [{ backendDOMNodeId: 600 + snapshot, role: { value: 'button' }, name: { value: 'New' } }]
    await observe()
  }
  expect(await execute('click', { observationId: first.observationId, target: first.elements[0].id })).toMatchObject(outcome)
})

it('forgets every ref when the tab or panel closes its page', async () => {
  const { runtime, contents, observe } = await setupGuest()
  await observe()
  const driver = (runtime as unknown as { drivers: Map<number, { refs: Map<number, unknown>; stableIds: Map<string, number> }> }).drivers.get(80)!
  expect(driver.refs.size).toBe(1)
  // Closing a tab or a panel destroys its guest webContents.
  for (const [event, listener] of contents.once.mock.calls as [string, () => void][]) if (event === 'destroyed') listener()
  expect({ registered: runtime.isRegistered(80), refs: driver.refs.size, stableIds: driver.stableIds.size }).toEqual({ registered: false, refs: 0, stableIds: 0 })
})
