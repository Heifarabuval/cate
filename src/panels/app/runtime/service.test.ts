// `cate app` served by the runtime (spec 007 T402): import only puts a panel
// on hold, export writes only `--out`, and nothing reaches the panels folder.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEntry } from '../contract'
import { soundFiles, type FixtureFile } from '../test/fixtures/hostile'
import { createAppImports, type AppImports } from './import'
import { appApiHandlers } from './service'

let root: string
let panneaux: string
let quarantine: string
let imports: AppImports
let trusted: boolean
let entries: AppEntry[]

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, item.name)
      if (item.isDirectory()) walk(full)
      else out[path.relative(dir, full)] = sha(fs.readFileSync(full))
    }
  }
  walk(dir)
  return out
}

function writeFolder(folder: string, files: FixtureFile[]): string {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(folder, file.path)), { recursive: true })
    fs.writeFileSync(path.join(folder, file.path), file.data)
  }
  return folder
}

const handlers = () =>
  appApiHandlers({ dir: panneaux, scanner: { list: () => entries }, imports, trust: { isTrusted: () => trusted } })

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-app-service-'))
  for (const real of ['.cate', '.claude']) expect(root.startsWith(path.join(os.homedir(), real))).toBe(false)
  panneaux = path.join(root, 'panneaux')
  quarantine = path.join(root, 'data', 'app-imports')
  fs.mkdirSync(panneaux, { recursive: true })
  trusted = true
  entries = []
  imports = createAppImports({
    dir: quarantine,
    panneauxDir: panneaux,
    grants: { get: () => undefined, grant: () => undefined },
    trust: { isTrusted: () => trusted },
    clientHas: () => true,
    refresh: async () => undefined
  })
  await imports.start()
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('cate app import', () => {
  it('answers the import id and the fingerprint, nothing else, and leaves the panels folder untouched', async () => {
    const source = writeFolder(path.join(root, 'sources', 'fusion'), soundFiles('fusion'))
    const result = await handlers().import({ source, fingerprint: undefined })
    expect(Object.keys(result).sort()).toEqual(['fingerprint', 'importId'])
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(tree(panneaux)).toEqual({})
    expect(fs.readdirSync(quarantine)).toEqual([result.importId])
  })

  it('lists pending imports with no bytes and no quarantine path', async () => {
    const source = writeFolder(path.join(root, 'sources', 'fusion'), soundFiles('fusion'))
    const { importId, fingerprint } = await handlers().import({ source, fingerprint: undefined })
    const listed = handlers().imports()
    expect(listed).toMatchObject([{ importId, appId: 'fusion', fingerprint, files: soundFiles('fusion').length }])
    const text = JSON.stringify(listed)
    expect(text).not.toContain(quarantine)
    expect(text).not.toContain('app-imports')
    for (const file of soundFiles('fusion')) expect(text).not.toContain(Buffer.from(file.data).toString('base64'))
  })

  it('refuses a wrong --empreinte, and an untrusted workspace, before anything is on hold', async () => {
    const source = writeFolder(path.join(root, 'sources', 'fusion'), soundFiles('fusion'))
    await expect(handlers().import({ source, fingerprint: '00000000' })).rejects.toThrow(/empreinte/)
    trusted = false
    await expect(handlers().import({ source, fingerprint: undefined })).rejects.toThrow(/non approuvé/)
    expect(handlers().imports()).toEqual([])
    expect(fs.readdirSync(quarantine)).toEqual([])
  })
})

describe('cate app export', () => {
  it('writes the package at --out, leaves the folder untouched and ends with the fingerprint', async () => {
    writeFolder(path.join(panneaux, 'fusion'), soundFiles('fusion'))
    entries = [{ id: 'fusion', status: 'error', error: 'x', warnings: [] }]
    const before = tree(panneaux)
    const out = path.join(root, 'fusion.cate-panneau')
    const result = await handlers().export({ id: 'fusion', out })
    expect(fs.existsSync(out)).toBe(true)
    expect(tree(panneaux)).toEqual(before)
    expect(Object.keys(result).at(-1)).toBe('fingerprint')
    // The package imports with the same fingerprint (SC-005).
    expect((await handlers().import({ source: out, fingerprint: undefined })).fingerprint).toBe(result.fingerprint)
  })

  it('refuses a panel the scanner does not know, so an id never escapes the panels folder', async () => {
    writeFolder(path.join(root, 'ailleurs'), soundFiles('ailleurs'))
    await expect(handlers().export({ id: '../ailleurs', out: path.join(root, 'x.cate-panneau') })).rejects.toThrow(/inconnu/)
    expect(fs.existsSync(path.join(root, 'x.cate-panneau'))).toBe(false)
  })
})
