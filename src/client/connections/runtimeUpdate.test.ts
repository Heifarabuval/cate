import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionState, WorkspaceConnection } from './connection'
import type { WorkspaceConnections } from './registry'
import { createRuntimeUpdates, runtimeMismatch, type RuntimeUpdates } from './runtimeUpdate'
import { RpcError } from '@kernel/rpc/contract'

let updates: RuntimeUpdates | null = null
afterEach(() => { updates?.dispose(); updates = null })

function fakeConnection(state: ConnectionState, idle = true, shared = false, runtimeBuild: string | null = '2.0.4+b') {
  const listeners = new Set<() => void>()
  const update = vi.fn(async (params: { ifIdle?: boolean }) => {
    if (params.ifIdle && (shared || !idle)) throw new RpcError('dirty', 'the runtime is in use', { reason: shared ? 'shared' : 'busy' })
  })
  const connection = {
    clientId: 'self',
    rpc: { remote: { epoch: 1, build: runtimeBuild ?? undefined } },
    state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    runtime: { runtime: { update, info: vi.fn(async () => ({ pid: 1, clients: [{ clientId: 'self' }, ...(shared ? [{ clientId: 'other' }] : [])] })), updateProgress: vi.fn(async () => null) } },
    set(next: ConnectionState, restarted = true) {
      if (restarted && (next.kind === 'connected' || next.kind === 'incompatible')) connection.rpc.remote.epoch++
      connection.state = next
      for (const l of [...listeners]) l()
    },
  }
  return connection
}

const startWith = (build: string | undefined, followBuild: boolean, ...all: ReturnType<typeof fakeConnection>[]) => {
  const connections = { getSnapshot: () => all as unknown as WorkspaceConnection[], subscribe: () => () => {} } as unknown as WorkspaceConnections
  updates = createRuntimeUpdates({ connections, version: '2.0.4', build, followBuild })
  return updates
}
const start = (...all: ReturnType<typeof fakeConnection>[]) => startWith('2.0.4+b', true, ...all)
const as = (c: ReturnType<typeof fakeConnection>) => c as unknown as WorkspaceConnection

it('tells which side a mismatch updates: never a newer runtime back', () => {
  expect(runtimeMismatch({ kind: 'incompatible', runtimeVersion: '2.0.3' }, '2.0.4')).toEqual({ update: 'runtime', runtimeVersion: '2.0.3', appVersion: '2.0.4' })
  expect(runtimeMismatch({ kind: 'incompatible', runtimeVersion: '2.1.0-beta.1' }, '2.0.4')).toMatchObject({ update: 'app' })
  expect(runtimeMismatch({ kind: 'connected' }, '2.0.4')).toBeNull()
})

it('updates an older runtime nothing uses without asking, and waits through its restart', async () => {
  const older = fakeConnection({ kind: 'incompatible', runtimeVersion: '2.0.3' })
  const runtimeUpdates = start(older)
  expect(older.runtime.runtime.update).toHaveBeenCalledWith({ version: '2.0.4', build: '2.0.4+b', ifIdle: true })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(older))).toEqual({ phase: 'restarting' }))
  older.set({ kind: 'offline', lastSeen: 1, retrying: true })
  expect(runtimeUpdates.run(as(older))).toEqual({ phase: 'restarting' })
  older.set({ kind: 'connected' })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(older))).toBeNull())
})

it('tries without asking once per incompatible spell; in use, it is left to the person', async () => {
  const busy = fakeConnection({ kind: 'incompatible', runtimeVersion: '2.0.3' }, false)
  const runtimeUpdates = start(busy)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(busy))).toBeNull())
  busy.set({ kind: 'incompatible', runtimeVersion: '2.0.3' })
  expect(busy.runtime.runtime.update).toHaveBeenCalledTimes(1)
  // Asked: the update goes without `ifIdle`.
  const asked = runtimeUpdates.update(as(busy))
  expect(busy.runtime.runtime.update).toHaveBeenLastCalledWith({ version: '2.0.4', build: '2.0.4+b' })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(busy))).toEqual({ phase: 'restarting' }))
  busy.set({ kind: 'connected' })
  await expect(asked).resolves.toBeNull()
  // A new spell (another runtime came up) tries again.
  busy.set({ kind: 'incompatible', runtimeVersion: '2.0.2' })
  expect(busy.runtime.runtime.update).toHaveBeenCalledTimes(3)
})

it('never touches a runtime newer than this client', () => {
  const newer = fakeConnection({ kind: 'incompatible', runtimeVersion: '2.1.0' })
  const runtimeUpdates = start(newer)
  expect(newer.runtime.runtime.update).not.toHaveBeenCalled()
  expect(runtimeUpdates.run(as(newer))).toBeNull()
})

it('leaves a compatible shared runtime usable after its idle update is refused', async () => {
  const shared = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' }, true, true)
  // Release-independent policy uses runtime.info, including runtimes whose
  // dirty error carries no structured reason.
  shared.runtime.runtime.update.mockRejectedValueOnce(new RpcError('dirty'))
  const runtimeUpdates = start(shared)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(shared))).toBeNull())
  expect(runtimeUpdates.required(as(shared))).toBeNull()
  expect(shared.state.kind).toBe('connected')
  shared.set({ kind: 'connected', runtimeVersion: '2.0.3' })
  expect(shared.runtime.runtime.update).toHaveBeenCalledTimes(1)
})

it('still requires protocol repair when a shared incompatible runtime cannot update idle', async () => {
  const shared = fakeConnection({ kind: 'incompatible', runtimeVersion: '2.0.3' }, true, true)
  const runtimeUpdates = start(shared)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(shared))).toBeNull())
  expect(runtimeUpdates.required(as(shared))).toMatchObject({ update: 'runtime' })
})

it('updates a compatible older runtime and waits for an actual disconnect', async () => {
  const older = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' })
  const runtimeUpdates = start(older)
  expect(older.runtime.runtime.update).toHaveBeenCalledWith({ version: '2.0.4', build: '2.0.4+b', ifIdle: true })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(older))).toEqual({ phase: 'restarting' }))
  // Being connected to the old daemon does not mean the restart completed.
  await Promise.resolve()
  expect(runtimeUpdates.run(as(older))).toEqual({ phase: 'restarting' })
  older.set({ kind: 'offline', lastSeen: 1, retrying: true })
  older.set({ kind: 'connected', runtimeVersion: '2.0.4' })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(older))).toBeNull())
  expect(older.runtime.runtime.update).toHaveBeenCalledTimes(1)
})

it('leaves compatible newer runtimes usable and asks before interrupting a busy older one', async () => {
  expect(runtimeMismatch({ kind: 'connected', runtimeVersion: '2.0.5' }, '2.0.4')).toBeNull()
  expect(runtimeMismatch({ kind: 'connected', runtimeVersion: '2.0.4' }, '2.0.4')).toBeNull()
  const busy = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' }, false)
  const runtimeUpdates = start(busy)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(busy))).toBeNull())
  expect(runtimeMismatch(busy.state, '2.0.4')).toBeNull()
  expect(runtimeUpdates.required(as(busy))).toMatchObject({ update: 'runtime' })
  const confirmed = runtimeUpdates.update(as(busy))
  expect(busy.runtime.runtime.update).toHaveBeenLastCalledWith({ version: '2.0.4', build: '2.0.4+b' })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(busy))).toEqual({ phase: 'restarting' }))
  busy.set({ kind: 'connected', runtimeVersion: '2.0.4' })
  await expect(confirmed).resolves.toBeNull()
})

const SAME = { kind: 'connected', runtimeVersion: '2.0.4' } as const

it('updates a runtime of the same version but another build, idle, once', async () => {
  const other = fakeConnection(SAME, true, false, '2.0.4+a')
  const runtimeUpdates = start(other)
  expect(other.runtime.runtime.update).toHaveBeenCalledTimes(1)
  expect(other.runtime.runtime.update).toHaveBeenCalledWith({ version: '2.0.4', build: '2.0.4+b', ifIdle: true })
  await vi.waitFor(() => expect(runtimeUpdates.run(as(other))).toEqual({ phase: 'restarting' }))
})

it('leaves a runtime of the same build alone', () => {
  const same = fakeConnection(SAME)
  start(same)
  expect(same.runtime.runtime.update).not.toHaveBeenCalled()
})

it.each([
  ['the app', undefined, '2.0.4+a'],
  ['the runtime', '2.0.4+b', null],
])('does not compare builds when %s does not know its own', (_who, appBuild, runtimeBuild) => {
  const unknown = fakeConnection(SAME, true, false, runtimeBuild)
  startWith(appBuild, true, unknown)
  expect(unknown.runtime.runtime.update).not.toHaveBeenCalled()
})

it('follows builds only when the shell asks (not on a bundle override, not on mobile)', () => {
  const other = fakeConnection(SAME, true, false, '2.0.4+a')
  startWith('2.0.4+b', false, other)
  expect(other.runtime.runtime.update).not.toHaveBeenCalled()
  // The build is still the target of an older release's update.
  const older = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' })
  startWith('2.0.4+b', false, older)
  expect(older.runtime.runtime.update).toHaveBeenCalledWith({ version: '2.0.4', build: '2.0.4+b', ifIdle: true })
})

it('never downgrades a newer runtime of another build', () => {
  const newer = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.5' }, true, false, '2.0.5+z')
  start(newer)
  expect(newer.runtime.runtime.update).not.toHaveBeenCalled()
})

it('asks before stopping work of a sole client on another build, and carries both builds', async () => {
  const busy = fakeConnection(SAME, false, false, '2.0.4+a')
  const runtimeUpdates = start(busy)
  await vi.waitFor(() => expect(runtimeUpdates.required(as(busy))).not.toBeNull())
  expect(runtimeUpdates.required(as(busy))).toEqual({ update: 'runtime', runtimeVersion: '2.0.4', appVersion: '2.0.4', runtimeBuild: '2.0.4+a', appBuild: '2.0.4+b' })
  expect(busy.runtime.runtime.update).toHaveBeenCalledTimes(1)
})

it('keeps a shared runtime of another build usable', async () => {
  const shared = fakeConnection(SAME, true, true, '2.0.4+a')
  const runtimeUpdates = start(shared)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(shared))).toBeNull())
  await vi.waitFor(() => expect(shared.runtime.runtime.info).toHaveBeenCalled())
  expect(runtimeUpdates.required(as(shared))).toBeNull()
  expect(shared.runtime.runtime.update).toHaveBeenCalledTimes(1)
})

it('does not loop when the build is still another one after the update', async () => {
  const stuck = fakeConnection(SAME, true, false, '2.0.4+a')
  const runtimeUpdates = start(stuck)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(stuck))).toEqual({ phase: 'restarting' }))
  stuck.set({ kind: 'offline', lastSeen: 1, retrying: true })
  stuck.set(SAME)
  await vi.waitFor(() => expect(runtimeUpdates.run(as(stuck))).toBeNull())
  stuck.set(SAME)
  expect(stuck.runtime.runtime.update).toHaveBeenCalledTimes(1)
  const asked = runtimeUpdates.update(as(stuck))
  await vi.waitFor(() => expect(runtimeUpdates.run(as(stuck))).toEqual({ phase: 'restarting' }))
  stuck.set({ kind: 'offline', lastSeen: 1, retrying: true })
  stuck.set(SAME)
  await expect(asked).resolves.toContain('still does not run this build')
  expect(stuck.runtime.runtime.update).toHaveBeenCalledTimes(2)
})

it.each(['offline', 'refused', 'closed'] as const)('does not report update success when reconnect ends %s', async (kind) => {
  vi.useFakeTimers()
  try {
    const older = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' }, false)
    const runtimeUpdates = start(older)
    await vi.advanceTimersByTimeAsync(0)
    const result = runtimeUpdates.update(as(older))
    await vi.advanceTimersByTimeAsync(0)
    older.set(kind === 'offline' ? { kind, lastSeen: 1, retrying: true } : kind === 'refused' ? { kind, message: 'No access' } : { kind })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(result).resolves.toContain('did not reconnect')
  } finally {
    vi.useRealTimers()
  }
})

it('does not mistake a connection state change for a restarted daemon', async () => {
  vi.useFakeTimers()
  try {
    const older = fakeConnection({ kind: 'connected', runtimeVersion: '2.0.3' }, false)
    const runtimeUpdates = start(older)
    await vi.advanceTimersByTimeAsync(0)
    const result = runtimeUpdates.update(as(older))
    await vi.advanceTimersByTimeAsync(0)
    older.set({ kind: 'connected', runtimeVersion: '2.0.4' }, false)
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(result).resolves.toContain('did not reconnect')
  } finally {
    vi.useRealTimers()
  }
})
