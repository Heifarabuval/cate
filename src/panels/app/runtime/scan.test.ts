import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppEntry, AppGrant } from '../contract'
import { createAppScanner, type AppScanner, type FsEvent } from './scan'

let root: string
let dir: string
let trusted: boolean
let trustListeners: Array<(state: { trusted: boolean }) => void>
let push: ((events: FsEvent[]) => Promise<void> | void) | undefined
let scanner: AppScanner
let grants: Map<string, AppGrant>

const manifest = (id: string, extra: object = {}) =>
  JSON.stringify({ schema: 1, id, name: `Panneau ${id}`, description: 'Une phrase.', ...extra })
const write = (id: string, file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, id, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, id, file), content)
}
const change = (id: string, file: string, type: FsEvent['type'] = 'update') => push?.([{ path: path.join(dir, id, file), type }])
const entry = (id: string) => scanner.list().find((item) => item.id === id)
const create = () => {
  scanner = createAppScanner({
    dir,
    trust: { isTrusted: () => trusted, onChange: (listener) => { trustListeners.push(listener); return () => { trustListeners = trustListeners.filter((l) => l !== listener) } } },
    watch: async (_dir, onEvents) => { push = onEvents; return () => { push = undefined } },
    grants: { get: (id) => grants.get(id) }
  })
  return scanner
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-scan-'))
  dir = path.join(root, 'panneaux')
  trusted = true
  trustListeners = []
  push = undefined
  grants = new Map()
})
afterEach(async () => {
  await scanner.dispose()
  fs.rmSync(root, { recursive: true, force: true })
})

it('lists a valid folder present at start as ready, and creates the folder when absent', async () => {
  fs.mkdirSync(dir, { recursive: true })
  write('fusion-excel', 'cate-panel.json', manifest('fusion-excel', { icon: 'table' }))
  await create().start()
  expect(entry('fusion-excel')).toMatchObject({ status: 'ready', name: 'Panneau fusion-excel', icon: 'table', source: 'local' })
  expect(scanner.manifest('fusion-excel')?.id).toBe('fusion-excel')
})

it('starts with no panels when the folder does not exist yet', async () => {
  await create().start()
  expect(scanner.list()).toEqual([])
  expect(fs.existsSync(dir)).toBe(true)
})

it('reports an invalid manifest as an error entry with the sentence, the others intact', async () => {
  write('bon', 'cate-panel.json', manifest('bon'))
  write('mauvais', 'cate-panel.json', manifest('autre'))
  write('vide', 'index.html', '<p>')
  write('casse', 'cate-panel.json', '{ nope')
  await create().start()
  expect(entry('bon')?.status).toBe('ready')
  expect(entry('mauvais')).toMatchObject({ status: 'error', error: expect.stringContaining('différent du nom du dossier') })
  expect(entry('vide')).toMatchObject({ status: 'error', error: expect.stringContaining('cate-panel.json') })
  expect(entry('casse')).toMatchObject({ status: 'error', error: expect.stringContaining('JSON') })
})

it('ignores hidden folders and plain files, and reports a symlinked folder instead of hiding it', async () => {
  write('.cache', 'cate-panel.json', manifest('.cache'))
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
  write('reel', 'cate-panel.json', manifest('reel'))
  fs.symlinkSync(path.join(dir, 'reel'), path.join(dir, 'lien'))
  await create().start()
  expect(scanner.list().map((item) => item.id)).toEqual(['lien', 'reel'])
  expect(entry('lien')).toMatchObject({ status: 'error', error: expect.stringContaining('lien symbolique') })
  expect(entry('reel')?.status).toBe('ready')
})

it('follows the real paths the watcher reports when the panels folder is reached through a symlink', async () => {
  fs.mkdirSync(path.join(root, 'vrai', 'panneaux', 'a'), { recursive: true })
  const real = fs.realpathSync(path.join(root, 'vrai'))
  fs.writeFileSync(path.join(real, 'panneaux', 'a', 'cate-panel.json'), manifest('a'))
  fs.symlinkSync(real, path.join(root, 'lien-racine'))
  dir = path.join(root, 'lien-racine', 'panneaux')
  await create().start()
  const pages: string[] = []
  scanner.onPage((id) => pages.push(id))
  fs.writeFileSync(path.join(real, 'panneaux', 'a', 'index.html'), '<p>2')
  await push?.([{ path: fs.realpathSync(path.join(dir, 'a', 'index.html')), type: 'update' }])
  expect(pages).toEqual(['a'])
  fs.mkdirSync(path.join(real, 'panneaux', 'b'))
  fs.writeFileSync(path.join(real, 'panneaux', 'b', 'cate-panel.json'), manifest('b'))
  await push?.([{ path: path.join(real, 'panneaux', 'b', 'cate-panel.json'), type: 'create' }])
  expect(entry('b')?.status).toBe('ready')
})

it('adds a folder created while running and tells the subscribers', async () => {
  await create().start()
  const seen: AppEntry[][] = []
  scanner.subscribe((entries) => seen.push(entries))
  write('nouveau', 'cate-panel.json', manifest('nouveau'))
  await change('nouveau', 'cate-panel.json', 'create')
  expect(entry('nouveau')?.status).toBe('ready')
  expect(seen).toHaveLength(1)
})

it('fires a page event, not a list change, when a page file is edited', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  write('a', 'index.html', '<p>1')
  await create().start()
  const lists: number[] = []
  const pages: string[] = []
  scanner.subscribe(() => lists.push(1))
  scanner.onPage((id) => pages.push(id))
  write('a', 'index.html', '<p>2')
  await change('a', 'index.html')
  expect(pages).toEqual(['a'])
  expect(lists).toEqual([])
})

it('removes the entry of a deleted folder', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  await create().start()
  fs.rmSync(path.join(dir, 'a'), { recursive: true })
  await change('a', '', 'delete')
  expect(entry('a')).toBeUndefined()
  expect(scanner.manifest('a')).toBeUndefined()
})

it('keeps the last valid manifest while an edit leaves a syntax error, and reports it', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  await create().start()
  write('a', 'cate-panel.json', '{ "schema": 1, ')
  await change('a', 'cate-panel.json')
  expect(entry('a')).toMatchObject({ status: 'error' })
  expect(scanner.manifest('a')?.id).toBe('a')
  write('a', 'cate-panel.json', manifest('a', { name: 'Corrigé' }))
  await change('a', 'cate-panel.json')
  expect(entry('a')).toMatchObject({ status: 'ready', name: 'Corrigé' })
})

it('blocks every panel while the workspace is not trusted, and releases them on trust', async () => {
  trusted = false
  write('a', 'cate-panel.json', manifest('a'))
  write('b', 'cate-panel.json', '{ nope')
  await create().start()
  expect(scanner.list().map((item) => item.status)).toEqual(['blocked', 'blocked'])
  trusted = true
  for (const listener of trustListeners) listener({ trusted: true })
  await scanner.idle()
  expect(entry('a')?.status).toBe('ready')
  expect(entry('b')?.status).toBe('error')
})

it('stops watching on dispose', async () => {
  await create().start()
  await scanner.dispose()
  expect(push).toBeUndefined()
  expect(trustListeners).toEqual([])
})

const sha = (content: string) => createHash('sha256').update(content).digest('hex')
const installed = (id: string): AppGrant => ({ appId: id, source: 'installed', manifestFingerprint: 'm', folderFingerprint: 'f', accepted: { files: { read: [], write: [] }, network: [], links: { receive: [], emit: [] } }, at: '2026-11-20T00:00:00.000Z' })

it('says installed for a panel with an installed grant and gives its files; local otherwise, without files (FR-020)', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  write('a', 'js/app.js', 'run()')
  write('b', 'cate-panel.json', manifest('b'))
  grants.set('a', installed('a'))
  await create().start()
  expect(entry('a')).toMatchObject({ status: 'ready', source: 'installed' })
  expect(entry('b')).toMatchObject({ status: 'ready', source: 'local' })
  expect(scanner.folderFiles('a')).toEqual([
    { path: 'cate-panel.json', sha256: sha(manifest('a')) },
    { path: 'js/app.js', sha256: sha('run()') }
  ])
  expect(scanner.folderFiles('b')).toBeUndefined()
})

it('reads no page byte of a local panel', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  write('a', 'index.html', '<p>')
  const readFile = vi.spyOn(fs.promises, 'readFile')
  try {
    await create().start()
    write('a', 'index.html', '<p>2')
    await change('a', 'index.html')
    expect(readFile.mock.calls.map(([file]) => path.basename(String(file)))).toEqual(['cate-panel.json', 'cate-panel.json'])
  } finally {
    readFile.mockRestore()
  }
})

it('follows a changed byte of an installed panel, and a grant given later on refresh', async () => {
  write('a', 'cate-panel.json', manifest('a'))
  write('a', 'app.js', 'run()')
  await create().start()
  expect(entry('a')).toMatchObject({ source: 'local' })
  grants.set('a', installed('a'))
  const pages: string[] = []
  scanner.onPage((id) => pages.push(id))
  await scanner.refresh('a')
  expect(entry('a')).toMatchObject({ source: 'installed' })
  expect(pages).toEqual(['a'])
  write('a', 'app.js', 'run() ')
  await change('a', 'app.js')
  expect(scanner.folderFiles('a')).toContainEqual({ path: 'app.js', sha256: sha('run() ') })
})
