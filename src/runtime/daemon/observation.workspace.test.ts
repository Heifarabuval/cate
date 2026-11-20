// End to end: the observation in a daemon composed with every module, in a
// temp HOME, driven by real RpcClients over the local socket. No window, no
// shell: the panels are browser panels, whose pages the test reports itself.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { apiCapability } from '@kernel/api/contract'
import { RpcClient, createCapabilityProxy } from '@kernel/rpc/client'
import { framePortOver } from '@kernel/rpc/contract'
import { createLifecycleBus } from '@kernel/lifecycle/contract'
import { createLogger, installLogSink } from '@kernel/log/contract'
import { settingsCapability } from '@kernel/settings/contract'
import { dialLocal } from '@runtime/transports/node'
import { workspaceCapability } from '@workspace/lifecycle/contract'
import { MAIN_WINDOW, documentCapability, type DocOp } from '@workspace/document/contract'
import { localDay, observationCapability } from '@workspace/observation/contract'
import { sessionCapability } from '@panels/framework/contract'
import { serveWorkspace, type Daemon } from './entry'
import { RUNTIME_VERSION } from '@runtime/daemon/contract'

let tmp: string
let home: string
let root: string
let daemon: Daemon | undefined
const clients: RpcClient[] = []
const saved = { HOME: process.env.HOME }

beforeEach(() => {
  installLogSink(() => {})
  // Short paths: a Unix socket path must fit in ~104 bytes.
  tmp = fs.realpathSync(fs.mkdtempSync('/tmp/cate-o-'))
  home = path.join(tmp, 'h')
  root = path.join(tmp, 'w')
  fs.mkdirSync(home)
  fs.mkdirSync(root)
  process.env.HOME = home
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await daemon?.stop({ kind: 'signal' })
  daemon = undefined
  process.env.HOME = saved.HOME
  installLogSink(null)
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function until<T>(read: () => Promise<T | undefined> | T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function start() {
  const result = await serveWorkspace({ root, home, lifecycle: createLifecycleBus(), log: createLogger('test') })
  if (result.kind !== 'serving') throw new Error('expected to serve')
  daemon = result.daemon
  const client = new RpcClient({
    version: RUNTIME_VERSION,
    identity: { client: { clientId: 'c1', device: { name: 'laptop', publicKey: 'fp' }, features: [] } },
  })
  clients.push(client)
  await client.attach(framePortOver(await dialLocal(daemon.endpoint), 'stream'))
  await createCapabilityProxy(client, workspaceCapability).setTrust({ trusted: true })
  let counter = 0
  const document = createCapabilityProxy(client, documentCapability)
  return {
    daemon,
    api: createCapabilityProxy(client, apiCapability),
    settings: createCapabilityProxy(client, settingsCapability),
    session: createCapabilityProxy(client, sessionCapability),
    observation: createCapabilityProxy(client, observationCapability),
    addBrowser: (id: string) => document.apply({
      op: {
        kind: 'addPanel',
        record: { id, type: 'browser', title: 'Plan secret ABC-123', fields: {} },
        at: { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's1' },
        opId: { clientId: 'c1', counter: ++counter },
      } as DocOp,
    }),
  }
}

const journalOf = (d: Daemon) => path.join(d.paths.observations, `${localDay(Date.now())}.jsonl`)
const readJournal = (d: Daemon) => fs.readFileSync(journalOf(d), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, string>)

describe.skipIf(process.platform === 'win32')('the observation in a daemon', () => {
  it('writes nothing, and makes no observations folder, until the person accepts', async () => {
    const w = await start()
    await w.addBrowser('b1')
    await until(async () => ((await w.api.call({ method: 'cate.panel.list' }) as unknown[]).length === 1 ? true : undefined))
    await pause(500)
    expect(fs.existsSync(w.daemon.paths.observations)).toBe(false)
    expect(await w.observation.state()).toEqual({ accord: null, pause: false, actif: false, erreur: null })
    await w.daemon.stop({ kind: 'signal' })
    expect(fs.existsSync(w.daemon.paths.observations)).toBe(false)
  }, 30_000)

  it('journals the panels and the pages once accepted, with no parameter and no title, and stops on a pause', async () => {
    const w = await start()
    const accepted = new Date().toISOString()
    await w.settings.set({ key: 'observationAccord', value: accepted })
    expect(await w.observation.state()).toMatchObject({ accord: accepted, pause: false, actif: true })

    await w.addBrowser('b1')
    const snapshot = await new Promise<{ activeTabId: string }>((resolve) => {
      const sub = w.session.subscribe({ panelId: 'b1' })
      sub.onEvent((event) => {
        const e = event as { kind: string; snapshot?: { activeTabId?: string } }
        if (e.kind === 'snapshot' && e.snapshot?.activeTabId) { sub.cancel(); resolve(e.snapshot as { activeTabId: string }) }
      })
    })
    await w.session.op({ panelId: 'b1', op: {
      kind: 'reportNavigation', tabId: snapshot.activeTabId, url: 'https://user:S3cretPw@example.com/a/b?token=TOK-123#frag-456', canGoBack: false, canGoForward: false,
    } })
    await w.session.op({ panelId: 'b1', op: {
      kind: 'reportNavigation', tabId: snapshot.activeTabId, url: 'https://mail.google.com/mail/u/0/?id=SECRET-9', canGoBack: false, canGoForward: false,
    } })
    await w.session.op({ panelId: 'b1', op: {
      kind: 'reportNavigation', tabId: snapshot.activeTabId, url: 'https://example.com/u/jane.doe@example.com/t/dG9rZW4=/s/abcdefghijklmnop', canGoBack: false, canGoForward: false,
    } })

    const lines = await until(() => {
      try {
        const read = readJournal(w.daemon)
        return read.length >= 3 ? read : undefined
      } catch { return undefined }
    })
    expect(lines.map((line) => [line.kind, line.panelType, line.ref])).toEqual([
      ['panel.created', 'browser', 'b1'],
      ['navigate', 'browser', 'https://example.com/a/b'],
      ['navigate', 'browser', 'https://example.com/u/*/t/*/s/*'],
    ])
    const text = fs.readFileSync(journalOf(w.daemon), 'utf8')
    for (const secret of ['S3cretPw', 'TOK-123', 'frag-456', 'SECRET-9', 'mail.google.com', 'Plan secret', 'ABC-123', 'jane.doe', 'dG9rZW4', 'abcdefghijklmnop']) expect(text).not.toContain(secret)
    expect(fs.statSync(w.daemon.paths.observations).mode & 0o777).toBe(0o700)
    expect(fs.statSync(journalOf(w.daemon)).mode & 0o777).toBe(0o600)

    await w.settings.set({ key: 'observationPause', value: true })
    await w.addBrowser('b2')
    await pause(500)
    expect(readJournal(w.daemon)).toHaveLength(3)
  }, 30_000)

  it('serves `cate observe list` to a terminal that was allowed, and never to a client', async () => {
    const w = await start()
    await w.settings.set({ key: 'observationAccord', value: new Date().toISOString() })
    await w.addBrowser('b1')
    await until(() => (fs.existsSync(journalOf(w.daemon)) ? true : undefined))

    const terminal = { kind: 'cli', id: 'cli:test' } as const
    const router = w.daemon.workspace.router
    await expect(router.call(terminal, 'cate.observe.list', {})).rejects.toMatchObject({ code: 'rejected', message: expect.stringMatching(/^observation-read-disabled/) })
    await w.settings.set({ key: 'cliObservationEnabled', value: true })
    // By default a count by type: nothing a terminal would record in terminal-logs/.
    const counted = await router.call(terminal, 'cate.observe.list', {})
    expect(counted).toEqual({ jours: 14, total: 1, illisibles: 0, types: [{ kind: 'panel.created', panelType: 'browser', count: 1 }] })
    expect(JSON.stringify(counted)).not.toContain('b1')
    const listing = await router.call(terminal, 'cate.observe.list', { refs: true }) as { observations: Array<Record<string, string>>; total: number; jours: number }
    expect(listing).toMatchObject({ total: 1, jours: 14 })
    expect(listing.observations[0]).toMatchObject({ kind: 'panel.created', panelType: 'browser', ref: 'b1' })
    expect(await router.call(terminal, 'cate.observe.list', { jours: 0 })).toMatchObject({ total: 1, jours: 0 })

    for (const args of [{}, { refs: true }]) {
      await expect(w.api.call({ method: 'cate.observe.list', args })).rejects.toMatchObject({ code: 'rejected', message: expect.stringMatching(/^observation-list-local-only/) })
    }
  }, 30_000)

  it('is read through the cate CLI itself, behind its setting', async () => {
    const w = await start()
    await w.settings.set({ key: 'observationAccord', value: new Date().toISOString() })
    await w.addBrowser('b1')
    await until(() => (fs.existsSync(journalOf(w.daemon)) ? true : undefined))

    const cli = path.join(tmp, 'cli', 'cli.cjs')
    await build({ entryPoints: ['src/cli/main.ts'], outfile: cli, platform: 'node', format: 'cjs', bundle: true, logLevel: 'silent' })
    const { token } = w.daemon.workspace.tokens.issue({ kind: 'cli', panelId: 'b1' })
    const run = (...args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], {
      env: { ...process.env, CATE_SOCKET: w.daemon.endpoint, CATE_TOKEN: token },
      timeout: 20_000,
    })

    await expect(run('observe', 'list', '--json')).rejects.toMatchObject({ stderr: expect.stringContaining('observation-read-disabled') })
    await w.settings.set({ key: 'cliObservationEnabled', value: true })
    const counted = (await run('observe', 'list', '--jours', '3', '--json')).stdout
    expect(JSON.parse(counted)).toEqual({ jours: 3, total: 1, illisibles: 0, types: [{ kind: 'panel.created', panelType: 'browser', count: 1 }] })
    expect(counted).not.toContain('b1')
    const withRefs = (await run('observe', 'list', '--jours', '3', '--refs', '--json')).stdout
    expect(JSON.parse(withRefs)).toMatchObject({ total: 1, jours: 3, illisibles: 0, observations: [{ kind: 'panel.created', panelType: 'browser', ref: 'b1' }] })
    await expect(run('observe', 'list', '--jours', '15', '--json')).rejects.toMatchObject({ code: expect.any(Number) })
  }, 60_000)

  it('writes what waits when the daemon stops', async () => {
    const w = await start()
    await w.settings.set({ key: 'observationAccord', value: new Date().toISOString() })
    await w.addBrowser('b1')
    await w.daemon.stop({ kind: 'signal' })
    expect(readJournal(w.daemon).map((line) => line.kind)).toEqual(['panel.created'])
  }, 30_000)
})
