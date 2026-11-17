import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStateFiles, type StateFiles, type StateFilesRead } from './stateFiles'

let dir: string
let files: StateFiles | undefined
let reads: StateFilesRead[]
const stateFile = () => path.join(dir, 'state.json')

/** What the CLI does: write a temp file, then `os.replace` it. */
function replaceState(value: unknown): void {
  const tmp = path.join(dir, `tmp-state-${Math.random().toString(36).slice(2)}`)
  writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value))
  renameSync(tmp, stateFile())
}
const need = (id: string, title: string) => ({ id, kind: 'task', title, ref: null, owner: 'agent', blocking: false, unblocks: null, panels: [], acceptance: null, budgetMin: null, evidence: null, status: 'open', closeFailed: false, agentBlocked: false, overBudget: false, updated: '2026-11-17T10:00:00+00:00' })
const state = (...titles: string[]) => ({ repo: 'cate', needs: titles.map((title, i) => need(`n${i + 1}`, title)), drafts: [], questions: [] })
const start = (pollMs = 2000) => {
  files = createStateFiles({ dir, pollMs, onChange: (read) => reads.push(read) })
  return files
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cate-agence-files-'))
  reads = []
})
afterEach(() => {
  files?.dispose()
  files = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('stateFiles', () => {
  it('reads the state and fills the defaults the CLI would', () => {
    replaceState(state('a'))
    const read = start().read()
    expect(read.error).toBeNull()
    expect(read.state?.needs.map((n) => n.title)).toEqual(['a'])
    expect(read.state).toMatchObject({ ghRepo: null, agentsActive: 0, titles: {}, panels: {} })
    expect(read.readAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('publishes an update in under 5 s after an os.replace (SC-004)', async () => {
    replaceState(state('a'))
    start()
    const before = Date.now()
    replaceState(state('a', 'b'))
    await vi.waitFor(() => expect(reads.at(-1)?.state?.needs).toHaveLength(2), { timeout: 5000 })
    expect(Date.now() - before).toBeLessThan(5000)
  })

  it('publishes nothing when a replace brings the same content', async () => {
    replaceState(state('a'))
    start(50)
    replaceState(state('a'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(reads).toEqual([])
  })

  it('keeps the last valid state and sets the error when the JSON is unreadable, then recovers', async () => {
    replaceState(state('a'))
    start(50)
    replaceState('{"needs": [')
    await vi.waitFor(() => expect(files!.read().error).toMatch(/\S/))
    expect(files!.read().state?.needs.map((n) => n.title)).toEqual(['a'])
    expect(reads.at(-1)?.error).toBe(files!.read().error)
    replaceState(state('b'))
    await vi.waitFor(() => expect(files!.read().error).toBeNull())
    expect(files!.read().state?.needs.map((n) => n.title)).toEqual(['b'])
  })

  it('has no state and no error when the file is absent, and picks it up when the folder appears', async () => {
    const missing = path.join(dir, 'later')
    files = createStateFiles({ dir: missing, pollMs: 50, onChange: (read) => reads.push(read) })
    expect(files.read()).toMatchObject({ state: null, error: null, drafts: {} })
    mkdirSync(missing)
    writeFileSync(path.join(missing, 'state.json'), JSON.stringify(state('a')))
    await vi.waitFor(() => expect(files!.read().state?.needs).toHaveLength(1), { timeout: 2000 })
  })

  it('reads the text of the open drafts only', () => {
    mkdirSync(path.join(dir, 'drafts'))
    for (const id of ['d1', 'd2', 'd3', 'd4']) writeFileSync(path.join(dir, 'drafts', `${id}.md`), `texte ${id}`)
    const draft = (id: string, statut: string) => ({ id, needId: 'n1', cible: 'issue:x/y', titre: null, statut, url: null })
    replaceState({ ...state('a'), drafts: [draft('d1', 'à valider'), draft('d2', 'envoyer'), draft('d3', 'envoyé'), draft('d4', 'abandonné'), draft('d5', 'à valider')] })
    expect(start().read().drafts).toEqual({ d1: 'texte d1', d2: 'texte d2' })
  })

  it('publishes a draft whose file changed', async () => {
    mkdirSync(path.join(dir, 'drafts'))
    writeFileSync(path.join(dir, 'drafts', 'd1.md'), 'avant')
    replaceState({ ...state('a'), drafts: [{ id: 'd1', needId: 'n1', cible: 'issue:x/y', titre: null, statut: 'à valider', url: null }] })
    start(50)
    writeFileSync(path.join(dir, 'drafts', 'd1.md'), 'après')
    await vi.waitFor(() => expect(files!.read().drafts.d1).toBe('après'))
    expect(reads.at(-1)?.drafts.d1).toBe('après')
  })

  it('never writes in the folder', async () => {
    mkdirSync(path.join(dir, 'drafts'))
    writeFileSync(path.join(dir, 'drafts', 'd1.md'), 'texte')
    replaceState({ ...state('a'), drafts: [{ id: 'd1', needId: 'n1', cible: 'issue:x/y', titre: null, statut: 'à valider', url: null }] })
    const listing = () => ['.', 'drafts'].flatMap((sub) => readdirSync(path.join(dir, sub)).map((name) => {
      const full = path.join(dir, sub, name)
      return `${sub}/${name}:${statSync(full).isFile() ? statSync(full).mtimeMs : 'dir'}`
    })).sort()
    const before = listing()
    start(50)
    replaceState('illisible')
    await vi.waitFor(() => expect(files!.read().error).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 150))
    files!.dispose()
    expect(listing().filter((entry) => !entry.startsWith('./state.json'))).toEqual(before.filter((entry) => !entry.startsWith('./state.json')))
    expect(readdirSync(dir).filter((name) => name !== 'state.json' && name !== 'drafts')).toEqual([])
  })

  it('stops publishing after dispose', async () => {
    replaceState(state('a'))
    start(50)
    files!.dispose()
    replaceState(state('a', 'b'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(reads).toEqual([])
  })
})
