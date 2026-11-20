import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const DAY = 24 * 3600 * 1000

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(dir)) return out
  const walk = (at: string) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, item.name)
      const key = path.relative(dir, full)
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
  imports = createAppImports({ dir: data, panneauxDir: panneaux, grants: { get: (id) => grants.get(id) }, now: () => clock })
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
    it(`refuses ${fixture.name} and leaves the data and panels folders intact`, async () => {
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
    const restarted = createAppImports({ dir: data, panneauxDir: panneaux, grants: { get: () => undefined }, now: () => clock })
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
    expect(() => createAppImports({ dir: path.join(panneaux, 'x'), panneauxDir: panneaux, grants: { get: () => undefined } })).toThrow(/panneaux/)
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
