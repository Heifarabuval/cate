import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppGrant } from '../contract'
import { bundleText, HOSTILE, manifestText, soundFiles, type FixtureFile } from '../test/fixtures/hostile'
import { createAppImports, type AppImports } from './import'

let root: string
let data: string
let panneaux: string
let sources: string
let clock: number
let grants: Map<string, AppGrant>
let imports: AppImports
let trusted: boolean
let refreshed: string[]

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const DAY = 24 * 3600 * 1000

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(dir)) return out
  const walk = (at: string) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, item.name)
      // Package paths are `/`-separated on every system.
      const key = path.relative(dir, full).split(path.sep).join('/')
      if (item.isSymbolicLink()) out[key] = `-> ${fs.readlinkSync(full)}`
      else if (item.isDirectory()) {
        out[`${key}/`] = 'dir'
        walk(full)
      } else out[key] = sha(fs.readFileSync(full))
    }
  }
  walk(dir)
  return out
}

function writeFolder(folder: string, files: FixtureFile[]): string {
  fs.mkdirSync(folder, { recursive: true })
  for (const file of files) {
    const target = path.join(folder, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (file.link !== undefined) fs.symlinkSync(file.link, target)
    else fs.writeFileSync(target, file.data)
  }
  return folder
}

let count = 0
function writeBundle(id: string, files: FixtureFile[], tamper?: Parameters<typeof bundleText>[0]['tamper']): string {
  const file = path.join(sources, `${id}-${count++}.cate-panneau`)
  fs.writeFileSync(file, bundleText({ id, files, tamper }))
  return file
}

const fingerprintOf = (files: FixtureFile[]) => {
  const lines = files.map((file) => `${file.path}\0${sha(Buffer.from(file.data))}`).sort()
  return sha(lines.join('\n'))
}

// Connection 1 is a client with a webview, 2 one without; null is the runtime itself.
const create = (patch: Partial<Parameters<typeof createAppImports>[0]> = {}) =>
  createAppImports({
    dir: data,
    panneauxDir: panneaux,
    grants: { get: (id) => grants.get(id), grant: (grant) => void grants.set(grant.appId, grant) },
    trust: { isTrusted: () => trusted },
    clientHas: (connectionId, feature) => feature === 'webview' && connectionId === 1,
    refresh: async (id) => void refreshed.push(id),
    now: () => clock,
    ...patch
  })

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-import-'))
  for (const real of ['.cate', '.claude']) expect(root.startsWith(path.join(os.homedir(), real))).toBe(false)
  data = path.join(root, 'data', 'app-imports')
  panneaux = path.join(root, 'panneaux')
  sources = path.join(root, 'sources')
  fs.mkdirSync(panneaux, { recursive: true })
  fs.mkdirSync(sources, { recursive: true })
  clock = Date.UTC(2026, 10, 20, 12)
  grants = new Map()
  trusted = true
  refreshed = []
  imports = create()
  await imports.start()
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('stage', () => {
  it('copies a sound bundle into the quarantine and nothing into the panels folder', async () => {
    const files = soundFiles('fusion')
    const before = tree(panneaux)
    const result = await imports.stage(writeBundle('fusion', files))
    expect(result).toEqual({ ok: true, importId: expect.any(String), fingerprint: fingerprintOf(files) })
    if (!result.ok) return
    expect(tree(panneaux)).toEqual(before)
    const staged = path.join(data, result.importId)
    for (const file of files) expect(fs.readFileSync(path.join(staged, file.path), 'utf-8')).toBe(file.data)
    expect(imports.list()).toEqual([
      expect.objectContaining({ importId: result.importId, appId: 'fusion', fingerprint: result.fingerprint, files: 3, at: new Date(clock).toISOString() })
    ])
    expect(imports.list()[0].replaces).toBeUndefined()
  })

  it('stages a folder the same way, with the same fingerprint as its bundle', async () => {
    const files = soundFiles('fusion')
    const fromFolder = await imports.stage(writeFolder(path.join(sources, 'fusion'), files))
    expect(fromFolder).toMatchObject({ ok: true, fingerprint: fingerprintOf(files) })
  })

  for (const fixture of HOSTILE) {
    // A file named `C:\evil.js` cannot be written to a folder on Windows.
    it.skipIf(process.platform === 'win32' && fixture.name === 'C:\\')(`refuses ${fixture.name} and leaves the data and panels folders intact`, async () => {
      const before = { data: tree(data), panneaux: tree(panneaux) }
      const source = fixture.only === 'folder' || (!fixture.tamper && fixture.only !== 'bundle')
        ? writeFolder(path.join(sources, `${count++}`, fixture.id), fixture.files)
        : writeBundle(fixture.id, fixture.files, fixture.tamper)
      const result = await imports.stage(source)
      expect(result).toEqual({ ok: false, error: expect.stringMatching(fixture.error) })
      expect({ data: tree(data), panneaux: tree(panneaux) }).toEqual(before)
      expect(imports.list()).toEqual([])
    })
  }

  it('refuses a wrong or short --empreinte before writing', async () => {
    const files = soundFiles('fusion')
    const source = writeBundle('fusion', files)
    const before = tree(data)
    expect(await imports.stage(source, { fingerprint: '0123456789abcdef' })).toEqual({ ok: false, error: expect.stringMatching(/ne commence pas par/) })
    expect(await imports.stage(source, { fingerprint: fingerprintOf(files).slice(0, 7) })).toEqual({ ok: false, error: expect.stringMatching(/au moins 8/) })
    expect(tree(data)).toEqual(before)
    expect(await imports.stage(source, { fingerprint: fingerprintOf(files).slice(0, 8).toUpperCase() })).toMatchObject({ ok: true })
  })

  it('refuses the 11th pending import', async () => {
    for (let n = 0; n < 10; n++) expect(await imports.stage(writeBundle(`panneau-${n}`, soundFiles(`panneau-${n}`)))).toMatchObject({ ok: true })
    const before = tree(data)
    expect(await imports.stage(writeBundle('panneau-10', soundFiles('panneau-10')))).toEqual({ ok: false, error: expect.stringMatching(/10 imports/) })
    expect(tree(data)).toEqual(before)
    expect(imports.list()).toHaveLength(10)
  })

  it('replaces the pending import of the same id', async () => {
    const first = await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    const changed = [...soundFiles('fusion'), { path: 'nouveau.js', data: '1' }]
    const second = await imports.stage(writeBundle('fusion', changed))
    if (!first.ok || !second.ok) throw new Error('staging failed')
    expect(imports.list().map((item) => item.importId)).toEqual([second.importId])
    expect(fs.existsSync(path.join(data, first.importId))).toBe(false)
  })

  it('purges an import older than 24 h', async () => {
    const first = await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    if (!first.ok) throw new Error(first.error)
    clock += DAY + 1
    expect(imports.list()).toEqual([])
    await imports.purge()
    expect(fs.existsSync(path.join(data, first.importId))).toBe(false)
  })

  it('empties the quarantine on start', async () => {
    await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    const restarted = create({ grants: { get: () => undefined, grant: () => {} } })
    await restarted.start()
    expect(tree(data)).toEqual({})
    expect(restarted.list()).toEqual([])
  })

  it('publishes the list to subscribers', async () => {
    const seen: number[] = []
    imports.subscribe((list) => seen.push(list.length))
    await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    expect(seen).toEqual([1])
  })

  it('refuses a quarantine inside the panels folder', () => {
    expect(() => create({ dir: path.join(panneaux, 'x') })).toThrow(/panneaux/)
  })
})

describe('replaces and diff', () => {
  const grant = (source: AppGrant['source']): AppGrant => ({ appId: 'fusion', source, manifestFingerprint: 'm', accepted: { files: { read: [], write: [] }, network: [], links: { receive: [], emit: [] } }, at: '2026-11-20T00:00:00.000Z' })

  it('says local for a folder without a grant, installed for an installed grant, nothing when absent', async () => {
    await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    expect(imports.list()[0].replaces).toBeUndefined()

    writeFolder(path.join(panneaux, 'fusion'), soundFiles('fusion'))
    await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    expect(imports.list()[0].replaces).toBe('local')

    grants.set('fusion', grant('installed'))
    await imports.stage(writeBundle('fusion', soundFiles('fusion')))
    expect(imports.list()[0].replaces).toBe('installed')
  })

  it('lists added, changed and removed files by sha256', async () => {
    writeFolder(path.join(panneaux, 'fusion'), [...soundFiles('fusion'), { path: 'ancien.js', data: 'a' }])
    const next = [
      { path: 'cate-panel.json', data: manifestText('fusion') },
      { path: 'index.html', data: '<!doctype html><p>nouvelle page</p>' },
      { path: 'js/app.js', data: 'document.body.textContent = "ok"' },
      { path: 'js/plus.js', data: 'b' }
    ]
    await imports.stage(writeBundle('fusion', next))
    expect(imports.list()[0].diff).toEqual({ added: ['js/plus.js'], changed: ['index.html'], removed: ['ancien.js'] })
  })
})

describe('accept', () => {
  const client = { connectionId: 1 }
  const staged = async (files = soundFiles('fusion')) => {
    const result = await imports.stage(writeBundle('fusion', files))
    if (!result.ok) throw new Error(result.error)
    return result
  }
  const untouched = () => ({ panneaux: tree(panneaux), grants: JSON.stringify([...grants]) })

  const refusals: Array<[string, (item: { importId: string; fingerprint: string }) => Promise<unknown>, RegExp]> = [
    ['the runtime itself', (item) => imports.accept({ ...item }, { connectionId: null }), /client/],
    ['a client without webview', (item) => imports.accept({ ...item }, { connectionId: 2 }), /webview/],
    ['an untrusted workspace', (item) => { trusted = false; return imports.accept({ ...item }, client) }, /non approuvé/],
    ['a fingerprint other than the card', (item) => imports.accept({ ...item, fingerprint: '0'.repeat(64) }, client), /carte/],
    ['an unknown import', (item) => imports.accept({ ...item, importId: 'inconnu' }, client), /introuvable ou expiré/],
    ['an expired import', (item) => { clock += DAY + 1; return imports.accept({ ...item }, client) }, /introuvable ou expiré/],
    ['quarantined bytes changed after the card', (item) => { fs.appendFileSync(path.join(data, item.importId, 'js/app.js'), ' '); return imports.accept({ ...item }, client) }, /modifié/],
    ['a quarantined file deleted by hand', (item) => { fs.rmSync(path.join(data, item.importId, 'js/app.js')); return imports.accept({ ...item }, client) }, /modifié|absent/]
  ]

  for (const [name, attempt, error] of refusals) {
    it(`refuses ${name} and writes neither the panels folder nor a grant`, async () => {
      const item = await staged()
      const before = untouched()
      expect(await attempt(item)).toEqual({ ok: false, error: expect.stringMatching(error) })
      expect(untouched()).toEqual(before)
      expect(refreshed).toEqual([])
    })
  }

  it('installs a sound bundle: same bytes, same fingerprint, an installed grant, the import gone', async () => {
    const files = soundFiles('fusion')
    const item = await staged(files)
    const seen: number[] = []
    imports.subscribe((list) => seen.push(list.length))
    expect(await imports.accept(item, client)).toEqual({ ok: true, appId: 'fusion' })
    for (const file of files) expect(fs.readFileSync(path.join(panneaux, 'fusion', file.path), 'utf-8')).toBe(file.data)
    expect(Object.keys(tree(panneaux)).filter((key) => key.startsWith('.'))).toEqual([])
    expect(fingerprintOf(files)).toBe(item.fingerprint)
    expect(grants.get('fusion')).toMatchObject({
      appId: 'fusion',
      source: 'installed',
      origin: expect.stringContaining('.cate-panneau'),
      folderFingerprint: item.fingerprint,
      files: files.map((file) => ({ path: file.path, sha256: sha(Buffer.from(file.data)) })).sort((a, b) => (a.path < b.path ? -1 : 1))
    })
    expect(imports.list()).toEqual([])
    expect(fs.existsSync(path.join(data, item.importId))).toBe(false)
    expect(seen).toEqual([0])
    expect(refreshed).toEqual(['fusion'])
    expect(await imports.accept(item, client)).toEqual({ ok: false, error: expect.stringMatching(/introuvable/) })
  })

  it('refuses an id already in the panels folder without the replace choice', async () => {
    writeFolder(path.join(panneaux, 'fusion'), [{ path: 'cate-panel.json', data: manifestText('fusion') }, { path: 'mon-travail.js', data: 'moi' }])
    const item = await staged()
    const before = untouched()
    expect(await imports.accept(item, client)).toEqual({ ok: false, error: expect.stringMatching(/Remplacer/) })
    expect(untouched()).toEqual(before)
    expect(imports.list()).toHaveLength(1)
  })

  it('replaces an existing id on the explicit choice, and leaves no old copy', async () => {
    writeFolder(path.join(panneaux, 'fusion'), [{ path: 'cate-panel.json', data: manifestText('fusion') }, { path: 'ancien.js', data: 'a' }])
    const files = soundFiles('fusion')
    const item = await staged(files)
    expect(await imports.accept({ ...item, replace: true }, client)).toEqual({ ok: true, appId: 'fusion' })
    expect(Object.keys(tree(panneaux)).sort()).toEqual(['fusion/', ...files.map((file) => `fusion/${file.path}`), ...dirsOf(files)].sort())
  })

  it('a cut at the rename leaves the previous folder intact and no hidden copy', async () => {
    const previous = [{ path: 'cate-panel.json', data: manifestText('fusion') }, { path: 'ancien.js', data: 'a' }]
    writeFolder(path.join(panneaux, 'fusion'), previous)
    const item = await staged()
    const before = untouched()
    const target = path.join(panneaux, 'fusion')
    const real = fs.promises.rename
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === target && path.basename(String(from)).startsWith('.import-')) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      return real(from, to)
    })
    try {
      expect(await imports.accept({ ...item, replace: true }, client)).toEqual({ ok: false, error: expect.stringMatching(/installation a échoué/) })
    } finally {
      rename.mockRestore()
    }
    expect(untouched()).toEqual(before)
    expect(fs.readdirSync(panneaux)).toEqual(['fusion'])
    expect(imports.list()).toHaveLength(1)
  })

  it('a cut at the rename of a new id leaves the panels folder empty', async () => {
    const item = await staged()
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }))
    try {
      expect(await imports.accept(item, client)).toMatchObject({ ok: false })
    } finally {
      rename.mockRestore()
    }
    expect(fs.readdirSync(panneaux)).toEqual([])
    expect(grants.size).toBe(0)
  })

  it('drops a pending import and its quarantine', async () => {
    const item = await staged()
    await imports.drop(item.importId)
    expect(imports.list()).toEqual([])
    expect(fs.existsSync(path.join(data, item.importId))).toBe(false)
  })
})

const dirsOf = (files: FixtureFile[]) => [...new Set(files.filter((file) => file.path.includes('/')).map((file) => `fusion/${file.path.split('/').slice(0, -1).join('/')}/`))]
