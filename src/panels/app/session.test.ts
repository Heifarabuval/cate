import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '@kernel/log/contract'
import type { Json, PanelRecord } from '@workspace/document/contract'
import type { OpContext, SessionKit } from '@panels/framework/runtime'
import { createHash } from 'node:crypto'
import { folderFingerprint, type AppSnapshot, type FolderFile } from './contract'
import { createAppGrants, type AppGrants } from './runtime/grants'
import { createAppScanner, type AppScanner, type FsEvent } from './runtime/scan'
import { AppSession } from './session'

let base: string
let dir: string
let trusted: boolean
let trustListeners: Array<(state: { trusted: boolean }) => void>
let push: ((events: FsEvent[]) => Promise<void> | void) | undefined
let scanner: AppScanner
let grants: AppGrants
let session: AppSession
let webview: boolean

const manifest = (extra: object = {}) => JSON.stringify({ schema: 1, id: 'fusion', name: 'Fusion', description: 'Une phrase.', ...extra })
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, 'fusion', file)), { recursive: true })
  fs.writeFileSync(path.join(dir, 'fusion', file), content)
}
const touch = (file: string, type: FsEvent['type'] = 'update') => push?.([{ path: path.join(dir, 'fusion', file), type }])
const ctx = (connectionId: number | null = 1): OpContext => ({ clientId: 'c1', connectionId })
const snap = (): AppSnapshot => session.snapshot()
// The grant op carries the fingerprint of the card the user read.
const grantOp = () => ({ kind: 'grant' as const, fingerprint: snap().fingerprint ?? 'none' })
const settle = async () => {
  await scanner.idle()
  await session.idle()
}
const trustPort = () => ({
  isTrusted: () => trusted,
  onChange: (listener: (state: { trusted: boolean }) => void) => {
    trustListeners.push(listener)
    return () => { trustListeners = trustListeners.filter((x) => x !== listener) }
  }
})

const kit = (): SessionKit => ({
  panelId: 'p1',
  document: {} as never,
  store: { read: () => undefined as Json | undefined, write: () => {}, flush: async () => {} },
  log: createLogger('test'),
  surface: async () => undefined
})
const record = (appId: string): PanelRecord => ({ id: 'p1', type: 'app', title: 'Panneau perso', fields: { appId } }) as never

let pageUrl: (id: string, entry: string) => Promise<string>
const hash = (text: string) => `h:${text.length}:${[...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)}`

async function open(appId = 'fusion') {
  grants ??= createAppGrants({ file: path.join(base, 'data', 'app-grants.json'), panneauxDir: dir })
  scanner = createAppScanner({
    dir,
    trust: trustPort(),
    watch: async (_d, onEvents) => { push = onEvents; return () => { push = undefined } },
    grants
  })
  await scanner.start()
  session = new AppSession(kit(), record(appId), {
    scanner,
    grants,
    server: { urlFor: (id, entry) => pageUrl(id, entry) },
    trust: trustPort(),
    clientHas: (connectionId, feature) => feature !== 'webview' || webview || connectionId === null,
    hash
  })
  await session.start()
  await settle()
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'app-session-')))
  dir = path.join(base, 'panneaux')
  fs.mkdirSync(dir, { recursive: true })
  trusted = true
  webview = true
  pageUrl = async (id, entry) => `http://127.0.0.1:1/token/${id}/${entry}`
  trustListeners = []
  push = undefined
})
afterEach(async () => {
  session?.dispose('shutdown')
  grants?.dispose()
  grants = undefined as never
  await scanner?.dispose()
  fs.rmSync(base, { recursive: true, force: true })
})

it('without a grant: needs-grant with the one-sentence card and no URL', async () => {
  write('cate-panel.json', manifest())
  write('index.html', '<p>')
  await open()
  expect(snap()).toMatchObject({ appId: 'fusion', name: 'Fusion', state: 'needs-grant', url: null, sentence: expect.stringContaining('Fusion') })
})

it('after the grant op: running with the page URL, and the grant is stored', async () => {
  write('cate-panel.json', manifest({ entry: 'pages/accueil.html' }))
  await open()
  await session.handleOp(grantOp(), ctx())
  expect(snap()).toMatchObject({ state: 'running', url: 'http://127.0.0.1:1/token/fusion/pages/accueil.html', sentence: null })
  expect(grants.get('fusion')).toMatchObject({ appId: 'fusion', source: 'local', accepted: { network: [] } })
})

it('the refuse op takes the grant back: nothing runs again', async () => {
  write('cate-panel.json', manifest())
  await open()
  await session.handleOp(grantOp(), ctx())
  await session.handleOp({ kind: 'refuse' }, ctx())
  expect(snap()).toMatchObject({ state: 'needs-grant', url: null })
  expect(grants.get('fusion')).toBeUndefined()
})

it('a grant is refused for a client without the webview feature (FR-016)', async () => {
  write('cate-panel.json', manifest())
  await open()
  webview = false
  await expect(session.handleOp(grantOp(), ctx(2))).rejects.toThrow(/webview/)
  expect(snap().state).toBe('needs-grant')
  expect(grants.get('fusion')).toBeUndefined()
})

it('a missing folder is missing, and the record stays', async () => {
  await open('absent')
  expect(snap()).toMatchObject({ state: 'missing', url: null, message: expect.stringContaining('introuvable') })
})

it('a folder deleted while running becomes missing; it runs again when it comes back', async () => {
  write('cate-panel.json', manifest())
  await open()
  await session.handleOp(grantOp(), ctx())
  fs.rmSync(path.join(dir, 'fusion'), { recursive: true })
  await touch('', 'delete')
  await settle()
  expect(snap()).toMatchObject({ state: 'missing', url: null })
  write('cate-panel.json', manifest())
  await touch('cate-panel.json', 'create')
  await settle()
  expect(snap()).toMatchObject({ state: 'running' })
})

it('an invalid manifest is an error with its sentence', async () => {
  write('cate-panel.json', manifest({ schema: 2 }))
  await open()
  expect(snap()).toMatchObject({ state: 'error', message: 'version de format inconnue', url: null })
})

it('an untrusted workspace blocks the panel, and trust releases it', async () => {
  trusted = false
  write('cate-panel.json', manifest())
  await open()
  expect(snap()).toMatchObject({ state: 'blocked', url: null })
  await expect(session.handleOp(grantOp(), ctx())).rejects.toThrow(/approuvé/)
  trusted = true
  for (const listener of trustListeners) listener({ trusted: true })
  await settle()
  expect(snap().state).toBe('needs-grant')
})

it('a page change while running reloads; the grant holds for a local panel', async () => {
  write('cate-panel.json', manifest())
  write('index.html', '<p>1')
  await open()
  await session.handleOp(grantOp(), ctx())
  const before = snap().reload
  write('index.html', '<p>2')
  await touch('index.html')
  await settle()
  expect(snap()).toMatchObject({ state: 'running', reload: before + 1 })
})

it('wider permissions send a local panel back to needs-grant, without a reload', async () => {
  write('cate-panel.json', manifest())
  await open()
  await session.handleOp(grantOp(), ctx())
  const before = snap().reload
  write('cate-panel.json', manifest({ permissions: { network: ['api.exemple.fr'] } }))
  await touch('cate-panel.json')
  await settle()
  expect(snap()).toMatchObject({ state: 'needs-grant', url: null, reload: before, sentence: expect.stringContaining('api.exemple.fr') })
})

it('a broken edit of the manifest keeps the running page and shows the error', async () => {
  write('cate-panel.json', manifest())
  await open()
  await session.handleOp(grantOp(), ctx())
  write('cate-panel.json', '{ "schema": 1, ')
  await touch('cate-panel.json')
  await settle()
  expect(snap()).toMatchObject({ state: 'running', message: expect.stringContaining('JSON') })
})

it('shows the fingerprint of the card while it asks, and none while the page runs', async () => {
  write('cate-panel.json', manifest())
  await open()
  expect(snap().fingerprint).toEqual(expect.any(String))
  await session.handleOp(grantOp(), ctx())
  expect(snap().fingerprint).toBeNull()
})

it('refuses a grant that does not carry the fingerprint of the card on screen', async () => {
  write('cate-panel.json', manifest())
  await open()
  const shown = snap().fingerprint!
  write('cate-panel.json', manifest({ permissions: { network: ['api.exemple.fr'] } }))
  await touch('cate-panel.json')
  // The user clicks on the card they read, which no longer matches the manifest.
  await expect(session.handleOp({ kind: 'grant', fingerprint: shown }, ctx())).rejects.toThrow(/a changé/)
  expect(grants.get('fusion')).toBeUndefined()
  await settle()
  expect(snap().fingerprint).not.toBe(shown)
  await session.handleOp(grantOp(), ctx())
  expect(grants.get('fusion')?.accepted.network).toEqual(['api.exemple.fr'])
})

it('an existing grant stops applying when the workspace stops being trusted, and applies again on trust', async () => {
  write('cate-panel.json', manifest())
  await open()
  await session.handleOp(grantOp(), ctx())
  expect(snap().state).toBe('running')
  trusted = false
  for (const listener of trustListeners) listener({ trusted: false })
  await settle()
  expect(snap()).toMatchObject({ state: 'blocked', url: null })
  trusted = true
  for (const listener of trustListeners) listener({ trusted: true })
  await settle()
  expect(snap().state).toBe('running')
})

it('says so when the page server cannot serve the entry, instead of storing a grant for nothing', async () => {
  write('cate-panel.json', manifest())
  await open()
  pageUrl = async () => { throw new Error('entry outside the panels folder') }
  await session.handleOp(grantOp(), ctx())
  expect(snap()).toMatchObject({ state: 'error', url: null, message: expect.stringContaining('entry outside the panels folder') })
})

it('an entry the server cannot find is an error, and runs once the file appears (FR-002)', async () => {
  write('cate-panel.json', manifest())
  pageUrl = async (_id, entry) => {
    if (!fs.existsSync(path.join(dir, 'fusion', entry))) throw new Error(`${entry} est absent du dossier`)
    return `http://127.0.0.1:1/token/fusion/${entry}`
  }
  await open()
  await session.handleOp(grantOp(), ctx())
  expect(snap()).toMatchObject({ state: 'error', url: null, message: expect.stringContaining('index.html est absent du dossier') })
  write('index.html', '<p>')
  await touch('index.html', 'create')
  await settle()
  expect(snap()).toMatchObject({ state: 'running', url: 'http://127.0.0.1:1/token/fusion/index.html', message: null })
})

describe('an installed panel (FR-020)', () => {
  const sha = (content: string) => createHash('sha256').update(content).digest('hex')
  const files: Array<[string, string]> = [['cate-panel.json', manifest()], ['index.html', '<p>1'], ['js/app.js', 'run()']]
  const accepted: FolderFile[] = files.map(([file, content]) => ({ path: file, sha256: sha(content) }))
  const install = async () => {
    for (const [file, content] of files) write(file, content)
    grants = createAppGrants({ file: path.join(base, 'data', 'app-grants.json'), panneauxDir: dir })
    grants.grant({ appId: 'fusion', source: 'installed', origin: 'fusion.cate-panneau', manifestFingerprint: 'm', folderFingerprint: folderFingerprint(accepted, hash), files: accepted, accepted: { files: { read: [], write: [] }, network: [], links: { receive: [], emit: [] } }, at: '2026-11-20T00:00:00.000Z' })
    await open()
  }

  it('runs while every byte is the accepted one', async () => {
    await install()
    expect(snap()).toMatchObject({ state: 'running', changes: null })
  })

  for (const [file] of files) {
    it(`goes back to needs-grant without a reload when one byte of ${file} changes, and names it`, async () => {
      await install()
      const before = snap().reload
      write(file, `${files.find(([name]) => name === file)![1]} `)
      await touch(file)
      await settle()
      expect(snap()).toMatchObject({ state: 'needs-grant', url: null, reload: before, changes: { added: [], changed: [file], removed: [] } })
    })
  }

  it('names an added and a removed file', async () => {
    await install()
    write('plus.js', '1')
    await touch('plus.js', 'create')
    fs.rmSync(path.join(dir, 'fusion', 'js', 'app.js'))
    await touch('js/app.js', 'delete')
    await settle()
    expect(snap()).toMatchObject({ state: 'needs-grant', changes: { added: ['plus.js'], changed: [], removed: ['js/app.js'] } })
  })

  it('a grant of the changed card accepts the folder as it is now, still installed', async () => {
    await install()
    write('js/app.js', 'run() ')
    await touch('js/app.js')
    await settle()
    const card = snap().fingerprint
    await session.handleOp(grantOp(), ctx())
    expect(snap()).toMatchObject({ state: 'running', changes: null })
    expect(grants.get('fusion')).toMatchObject({ source: 'installed', origin: 'fusion.cate-panneau', folderFingerprint: card, files: expect.arrayContaining([{ path: 'js/app.js', sha256: sha('run() ') }]) })
  })

  it('refuses a grant whose card is older than the folder', async () => {
    await install()
    write('js/app.js', 'run() ')
    await touch('js/app.js')
    await settle()
    const card = grantOp()
    write('js/app.js', 'run()  ')
    await touch('js/app.js')
    await settle()
    await expect(session.handleOp(card, ctx())).rejects.toThrow(/a changé/)
  })

  it('refusing takes the grant back and leaves the folder in place', async () => {
    await install()
    await session.handleOp({ kind: 'refuse' }, ctx())
    expect(grants.get('fusion')).toBeUndefined()
    expect(fs.readdirSync(path.join(dir, 'fusion')).sort()).toEqual(['cate-panel.json', 'index.html', 'js'])
    expect(snap().state).toBe('needs-grant')
  })
})
