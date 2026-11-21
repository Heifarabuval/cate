import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRegisseurs, type RegisseurHandle, type Regisseurs, type RegisseursOptions } from './regisseur'

// macOS arm64 uniquement (le régisseur est un processus POSIX)
const itPosix = it.skipIf(process.platform === 'win32')

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agence.mjs')

let tmp: string
let logFile: string
let regisseurs: Regisseurs
const handles: RegisseurHandle[] = []
/** The fake's environment for each panel's lease (its mode and port). */
let panelEnv: Record<string, Record<string, string>>
let leases: Array<{ panelId: string; token: string; revoked: boolean }>
let trust: ReturnType<typeof fakeTrust>

function fakeTrust(initial = true) {
  let trusted = initial
  const listeners = new Set<(state: { trusted: boolean }) => void>()
  return {
    isTrusted: () => trusted,
    requireTrusted() { if (!trusted) throw new Error('untrusted: workspace not trusted') },
    onChange(listener: (state: { trusted: boolean }) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: boolean) {
      trusted = next
      for (const listener of [...listeners]) listener({ trusted })
    },
  }
}

function create(options: Partial<RegisseursOptions> = {}): Regisseurs {
  return createRegisseurs({
    command: process.execPath,
    commandArgs: [FAKE],
    trust,
    async cliEnv(panelId) {
      const lease = { panelId, token: `tok-${panelId}-${leases.length + 1}`, revoked: false }
      leases.push(lease)
      return {
        env: { PATH: process.env.PATH ?? '', FAKE_AGENCE_LOG: logFile, ...panelEnv[panelId], CATE_TOKEN: lease.token },
        revoke() { lease.revoked = true },
      }
    },
    ...options,
  })
}

const freePort = () => new Promise<number>((resolve) => {
  const server = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address() as net.AddressInfo
    server.close(() => resolve(port))
  })
})
const events = (): Array<Record<string, unknown>> => {
  try { return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) } catch { return [] }
}
const ofKind = (event: string) => events().filter((entry) => entry.event === event)

/** Takes panel `panelId`'s reference on a root's regisseur, the fake running in `mode`. */
async function acquire(root: string, options: { mode?: string; port?: number; panelId?: string; on?: Regisseurs; env?: Record<string, string> } = {}): Promise<RegisseurHandle> {
  const port = options.port ?? await freePort()
  const panelId = options.panelId ?? 'p1'
  panelEnv[panelId] = { FAKE_AGENCE_PORT: String(port), ...(options.mode ? { FAKE_AGENCE_MODE: options.mode } : {}), ...options.env }
  const handle = (options.on ?? regisseurs).acquire({ root, panelId, port: () => port })
  handles.push(handle)
  return handle
}
const settled = (handle: RegisseurHandle, state: string) => vi.waitFor(() => expect(handle.view().state).toBe(state), { timeout: 5000 })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cate-regisseur-'))
  logFile = path.join(tmp, 'events.log')
  panelEnv = {}
  leases = []
  trust = fakeTrust()
  regisseurs = create()
})
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.release()
  await regisseurs.dispose()
  expect(regisseurs.running()).toBe(0)
  rmSync(tmp, { recursive: true, force: true })
})

describe('regisseur', () => {
  it('starts `agence watch --token-stdin` in the root and gives the form token on stdin only', async () => {
    const handle = await acquire(tmp)
    expect(handle.view().state).toBe('starting')
    await settled(handle, 'running')
    const [start] = ofKind('start')
    expect(start).toMatchObject({ argv: ['watch', '--token-stdin'], cwd: realpathSync(tmp), root: tmp, tokenInEnv: false })
    expect((start.token as string).length).toBeGreaterThanOrEqual(24)
    expect(handle.view()).toMatchObject({ error: null, settingsHint: null })
  })

  it('posts with the token and a JSON Accept, and returns the regisseur\'s code and message', async () => {
    const handle = await acquire(tmp)
    await settled(handle, 'running')
    await expect(handle.post('/draft/d1/send', { h: 'abc' })).resolves.toEqual({ code: 200, message: 'ok' })
    const [post] = ofKind('post')
    expect(post).toMatchObject({ method: 'POST', url: '/draft/d1/send', accept: 'application/json', form: { h: 'abc' } })
    expect((post.form as Record<string, string>).token).toBe(ofKind('start')[0].token)
    // A refusal is an answer, not an error.
    await expect(handle.post('/draft/d1/send', { h: 'ancien' })).resolves.toEqual({ code: 409, message: 'texte a changé' })
  })

  it('posts a list as the same field repeated, in order (several settings in one write)', async () => {
    const handle = await acquire(tmp)
    await settled(handle, 'running')
    await handle.post('/pratiques/set', { cle: ['a.b', 'c'], valeur: ['2', '"x"'] })
    const params = new URLSearchParams(ofKind('post')[0].body as string)
    expect(params.getAll('cle')).toEqual(['a.b', 'c'])
    expect(params.getAll('valeur')).toEqual(['2', '"x"'])
  })

  it('runs one process for two references of the same root, and one per root', async () => {
    const port = await freePort()
    const first = await acquire(tmp, { port })
    const second = await acquire(tmp, { port, panelId: 'p2' })
    await settled(first, 'running')
    expect(second.view().state).toBe('running')
    expect(ofKind('start')).toHaveLength(1)
    mkdirSync(path.join(tmp, 'other'))
    const other = await acquire(path.join(tmp, 'other'), { panelId: 'p3' })
    await settled(other, 'running')
    expect(ofKind('start')).toHaveLength(2)
    expect(regisseurs.running()).toBe(2)
  })

  itPosix('keeps the process when a reference that does not own it goes, and sends SIGTERM at the last release', async () => {
    const port = await freePort()
    const owner = await acquire(tmp, { port })
    const other = await acquire(tmp, { port, panelId: 'p2' })
    await settled(owner, 'running')
    other.release()
    await pause(150)
    expect(ofKind('sigterm')).toHaveLength(0)
    expect(owner.view().state).toBe('running')
    owner.release()
    await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 5000 })
    await vi.waitFor(() => expect(regisseurs.running()).toBe(0))
    expect(owner.view().state).toBe('stopped')
  })

  it('owns its CLI lease: taken for the process, revoked when the process ends', async () => {
    const handle = await acquire(tmp)
    await settled(handle, 'running')
    expect(leases).toEqual([{ panelId: 'p1', token: 'tok-p1-1', revoked: false }])
    expect(ofKind('start')[0].cateToken).toBe('tok-p1-1')
    handle.release()
    await vi.waitFor(() => expect(leases[0].revoked).toBe(true), { timeout: 5000 })
  })

  it('restarts in a remaining panel\'s name when the panel it runs for goes, so its cate calls keep working', async () => {
    const port = await freePort()
    const first = await acquire(tmp, { port })
    const second = await acquire(tmp, { port, panelId: 'p2' })
    await settled(first, 'running')
    first.release()
    await vi.waitFor(() => expect(ofKind('start')).toHaveLength(2), { timeout: 5000 })
    await settled(second, 'running')
    expect(ofKind('start')[1].cateToken).toBe(leases[1].token)
    expect(leases.map(({ panelId, revoked }) => ({ panelId, revoked }))).toEqual([{ panelId: 'p1', revoked: true }, { panelId: 'p2', revoked: false }])
    expect(regisseurs.running()).toBe(1)
    await expect(second.post('/draft/d1/send', { h: 'abc' })).resolves.toEqual({ code: 200, message: 'ok' })
  })

  itPosix('starts a new one after the last release, once the old one is gone', async () => {
    const port = await freePort()
    const first = await acquire(tmp, { port })
    await settled(first, 'running')
    first.release()
    const second = await acquire(tmp, { port })
    await settled(second, 'running')
    expect(ofKind('start')).toHaveLength(2)
    expect(ofKind('sigterm')).toHaveLength(1)
  })

  it('says it stopped when the process dies on its own, does not restart it by itself, and restarts on demand or on a new reference', async () => {
    const port = await freePort()
    const handle = await acquire(tmp, { port })
    await settled(handle, 'running')
    process.kill(ofKind('start')[0].pid as number, 'SIGKILL')
    await settled(handle, 'stopped')
    expect(handle.view().error).toMatch(/SIGKILL|arrêté/)
    await vi.waitFor(() => expect(leases[0].revoked).toBe(true))
    await pause(200)
    expect(ofKind('start')).toHaveLength(1)
    expect(handle.restart()).toBe(true)
    await settled(handle, 'running')
    expect(ofKind('start')).toHaveLength(2)
    expect(handle.restart()).toBe(false)
    process.kill(ofKind('start')[1].pid as number, 'SIGKILL')
    await settled(handle, 'stopped')
    const another = await acquire(tmp, { port, panelId: 'p2' })
    await settled(another, 'running')
    expect(ofKind('start')).toHaveLength(3)
  })

  it('starts nothing without trust, then starts when trust is granted', async () => {
    trust.set(false)
    const handle = await acquire(tmp)
    await settled(handle, 'stopped')
    expect(handle.view().error).toMatch(/trust/)
    expect(leases).toEqual([])
    await pause(100)
    expect(ofKind('start')).toHaveLength(0)
    trust.set(true)
    await settled(handle, 'running')
  })

  itPosix('stops when trust is revoked, revoking its lease, and comes back when trust returns', async () => {
    const handle = await acquire(tmp)
    await settled(handle, 'running')
    trust.set(false)
    await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 5000 })
    await settled(handle, 'stopped')
    expect(handle.view().error).toMatch(/trust/)
    await vi.waitFor(() => expect(leases[0].revoked).toBe(true))
    expect(handle.restart()).toBe(false)
    trust.set(true)
    await settled(handle, 'running')
    expect(ofKind('start')).toHaveLength(2)
  })

  it('refuses posts when it is not running', async () => {
    const handle = await acquire(tmp, { mode: 'busy' })
    await settled(handle, 'external')
    await expect(handle.post('/draft/d1/send', {})).rejects.toThrow('regisseur-unavailable')
  })

  it('is external and read only when the port is already served', async () => {
    const handle = await acquire(tmp, { mode: 'busy' })
    await settled(handle, 'external')
    expect(handle.view().error).toMatch(/déjà actif sur \d+/)
    expect(ofKind('start')).toHaveLength(0)
  })

  it('is missing, with its message, when the CLI does not know --token-stdin', async () => {
    const handle = await acquire(tmp, { mode: 'unknown-option' })
    await settled(handle, 'missing')
    expect(handle.view().error).toMatch(/unrecognized arguments: --token-stdin/)
  })

  it('is missing, with a message, when `agence` is not installed (ENOENT), and gives its lease back', async () => {
    const absent = create({ command: path.join(tmp, 'no-such-agence'), commandArgs: [] })
    try {
      const handle = await acquire(tmp, { on: absent })
      await settled(handle, 'missing')
      expect(handle.view().error).toMatch(/agence/)
      expect(absent.running()).toBe(0)
      await vi.waitFor(() => expect(leases.every((lease) => lease.revoked)).toBe(true))
    } finally { await absent.dispose() }
  })

  it('takes the settings hint from the regisseur\'s stderr', async () => {
    const handle = await acquire(tmp, { mode: 'settings' })
    await vi.waitFor(() => expect(handle.view().settingsHint).toMatch(/^réglages CLI du workspace à activer dans Cate/), { timeout: 5000 })
    expect(handle.view().state).toBe('running')
  })

  it('tells its listeners when the view changes', async () => {
    const handle = await acquire(tmp)
    const seen: string[] = []
    handle.onChange((view) => seen.push(view.state))
    await settled(handle, 'running')
    expect(seen).toContain('running')
  })

  // agence.py has no SIGTERM handler: a click killed between its GitHub call
  // and its state write leaves the draft « à valider », and a second Envoyer
  // creates the issue twice. A stop waits for the clicks in flight.
  itPosix('lets a click in flight finish before it restarts for another owner, and refuses new clicks meanwhile', async () => {
    const port = await freePort()
    const first = await acquire(tmp, { port })
    const second = await acquire(tmp, { port, panelId: 'p2' })
    await settled(first, 'running')
    const slow = first.post('/draft/d1/send', { h: 'lent' })
    await vi.waitFor(() => expect(ofKind('post')).toHaveLength(1))
    first.release()
    await expect(second.post('/draft/d1/send', { h: 'abc' })).rejects.toThrow('regisseur-unavailable')
    await expect(slow).resolves.toEqual({ code: 200, message: 'ok' })
    await vi.waitFor(() => expect(ofKind('start')).toHaveLength(2), { timeout: 5000 })
    const kinds = events().map((entry) => entry.event)
    expect(kinds.indexOf('sigterm')).toBeGreaterThan(kinds.indexOf('replied'))
    await settled(second, 'running')
  })

  itPosix('lets a click in flight finish when the last panel goes', async () => {
    const handle = await acquire(tmp)
    await settled(handle, 'running')
    const slow = handle.post('/draft/d1/send', { h: 'lent' })
    await vi.waitFor(() => expect(ofKind('post')).toHaveLength(1))
    handle.release()
    await expect(slow).resolves.toEqual({ code: 200, message: 'ok' })
    await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 5000 })
    const kinds = events().map((entry) => entry.event)
    expect(kinds.indexOf('sigterm')).toBeGreaterThan(kinds.indexOf('replied'))
  })

  itPosix('stops anyway once the wait for clicks in flight reaches its bound', async () => {
    const bounded = create({ drainMaxMs: 150 })
    try {
      const handle = await acquire(tmp, { on: bounded, env: { FAKE_AGENCE_DELAY: '3000' } })
      await settled(handle, 'running')
      const slow = handle.post('/draft/d1/send', { h: 'lent' })
      slow.catch(() => {})
      await vi.waitFor(() => expect(ofKind('post')).toHaveLength(1))
      const released = Date.now()
      handle.release()
      await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 2000 })
      expect(Date.now() - released).toBeLessThan(1500)
      expect(ofKind('replied')).toHaveLength(0)
      await expect(slow).rejects.toThrow()
    } finally { await bounded.dispose() }
  })

  it('starts again when trust comes back before the stopped process exited', async () => {
    const slowToDie = create({ killAfterMs: 300 })
    try {
      const handle = await acquire(tmp, { mode: 'stubborn', on: slowToDie })
      await settled(handle, 'running')
      trust.set(false)
      trust.set(true)
      await vi.waitFor(() => expect(ofKind('start')).toHaveLength(2), { timeout: 5000 })
      await settled(handle, 'running')
    } finally { await slowToDie.dispose() }
  })

  itPosix('stops every process at dispose and waits for them, killing one that ignores SIGTERM', async () => {
    const stubborn = create({ killAfterMs: 200 })
    try {
      const handle = await acquire(tmp, { mode: 'stubborn', on: stubborn })
      await settled(handle, 'running')
      const started = Date.now()
      await stubborn.dispose()
      expect(stubborn.running()).toBe(0)
      expect(ofKind('sigterm')).toHaveLength(1)
      expect(Date.now() - started).toBeGreaterThanOrEqual(150)
      expect(() => process.kill(ofKind('start')[0].pid as number, 0)).toThrow()
      await vi.waitFor(() => expect(leases[0].revoked).toBe(true))
    } finally { await stubborn.dispose() }
  })
})
