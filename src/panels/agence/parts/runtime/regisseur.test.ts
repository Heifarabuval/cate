import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRegisseurs, type RegisseurHandle, type Regisseurs } from './regisseur'

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agence.mjs')

let tmp: string
let logFile: string
let regisseurs: Regisseurs
const handles: RegisseurHandle[] = []

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

/** Takes a reference on a root's regisseur, the fake running in `mode`. */
async function acquire(root: string, mode = '', port?: number): Promise<RegisseurHandle> {
  const chosen = port ?? await freePort()
  const handle = regisseurs.acquire({
    root,
    port: () => chosen,
    env: { PATH: process.env.PATH ?? '', FAKE_AGENCE_PORT: String(chosen), FAKE_AGENCE_LOG: logFile, ...(mode ? { FAKE_AGENCE_MODE: mode } : {}) },
  })
  handles.push(handle)
  return handle
}
const settled = (handle: RegisseurHandle, state: string) => vi.waitFor(() => expect(handle.view().state).toBe(state), { timeout: 5000 })

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cate-regisseur-'))
  logFile = path.join(tmp, 'events.log')
  regisseurs = createRegisseurs({ command: process.execPath, commandArgs: [FAKE] })
})
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.release()
  await vi.waitFor(() => expect(regisseurs.running()).toBe(0), { timeout: 5000 })
  rmSync(tmp, { recursive: true, force: true })
})

describe('regisseur', () => {
  it('starts `agence watch --token-stdin` in the root and gives the token on stdin only', async () => {
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

  it('runs one process for two references of the same root, and one per root', async () => {
    const port = await freePort()
    const first = await acquire(tmp, '', port)
    const second = regisseurs.acquire({ root: tmp, port: () => port, env: { PATH: process.env.PATH ?? '' } })
    handles.push(second)
    await settled(first, 'running')
    expect(second.view().state).toBe('running')
    expect(ofKind('start')).toHaveLength(1)
    mkdirSync(path.join(tmp, 'other'))
    const other = await acquire(path.join(tmp, 'other'))
    await settled(other, 'running')
    expect(ofKind('start')).toHaveLength(2)
    expect(regisseurs.running()).toBe(2)
  })

  it('keeps the process while a reference is left, and sends SIGTERM at the last release', async () => {
    const port = await freePort()
    const first = await acquire(tmp, '', port)
    const second = regisseurs.acquire({ root: tmp, port: () => port, env: {} })
    await settled(first, 'running')
    first.release()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(ofKind('sigterm')).toHaveLength(0)
    expect(second.view().state).toBe('running')
    second.release()
    await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 5000 })
    await vi.waitFor(() => expect(regisseurs.running()).toBe(0))
    expect(second.view().state).toBe('stopped')
  })

  it('starts a new one after the last release, once the old one is gone', async () => {
    const port = await freePort()
    const first = await acquire(tmp, '', port)
    await settled(first, 'running')
    first.release()
    const second = await acquire(tmp, '', port)
    await settled(second, 'running')
    expect(ofKind('start')).toHaveLength(2)
    expect(ofKind('sigterm')).toHaveLength(1)
    expect(second.view().state).not.toBe('external')
  })

  it('refuses posts when it is not running', async () => {
    const handle = await acquire(tmp, 'busy')
    await settled(handle, 'external')
    await expect(handle.post('/draft/d1/send', {})).rejects.toThrow('regisseur-unavailable')
  })

  it('is external and read only when the port is already served', async () => {
    const handle = await acquire(tmp, 'busy')
    await settled(handle, 'external')
    expect(handle.view().error).toMatch(/déjà actif sur \d+/)
    expect(ofKind('start')).toHaveLength(0)
  })

  it('is missing, with its message, when the CLI does not know --token-stdin', async () => {
    const handle = await acquire(tmp, 'unknown-option')
    await settled(handle, 'missing')
    expect(handle.view().error).toMatch(/unrecognized arguments: --token-stdin/)
  })

  it('is missing, with a message, when `agence` is not installed (ENOENT)', async () => {
    const absent = createRegisseurs({ command: path.join(tmp, 'no-such-agence') })
    const handle = absent.acquire({ root: tmp, port: () => 40113, env: {} })
    handles.push(handle)
    await settled(handle, 'missing')
    expect(handle.view().error).toMatch(/agence/)
    expect(absent.running()).toBe(0)
  })

  it('takes the settings hint from the regisseur\'s stderr', async () => {
    const handle = await acquire(tmp, 'settings')
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
})
