// Finds the custom panels of `~/.cate/panneaux/` and follows them (spec 008
// D3). A folder is one panel: `cate-panel.json` and its pages. A bad manifest
// is an entry with one sentence, never a failure of the others; an edit that
// breaks the manifest keeps the last valid one, so an open panel keeps
// running. The folder path and the watcher are injected: tests never touch `~`.

import fs from 'node:fs'
import path from 'node:path'
import { parseManifest, type AppEntry, type AppManifest } from '../contract'

export interface FsEvent {
  path: string
  type: 'create' | 'update' | 'delete'
}

export interface AppScannerDeps {
  /** `~/.cate/panneaux`. */
  dir: string
  trust: {
    isTrusted(): boolean
    onChange(listener: (state: { trusted: boolean }) => void): () => void
  }
  /** Watches `dir`, returns the unwatch function. */
  watch(dir: string, onEvents: (events: FsEvent[]) => Promise<void> | void): Promise<() => void>
}

export interface AppScanner {
  /** Creates the folder when absent, scans it and starts watching. */
  start(): Promise<void>
  /** Resolves once the first scan is done (at once when not started). */
  ready(): Promise<void>
  list(): AppEntry[]
  /** The last valid manifest of a panel, kept across a broken edit. */
  manifest(id: string): AppManifest | undefined
  /** The list changed (a panel added, removed, fixed or broken). */
  subscribe(listener: (entries: AppEntry[]) => void): () => void
  /** A file of the panel's folder changed, its manifest included. */
  onPage(listener: (id: string) => void): () => void
  /** Waits for the scans in flight. */
  idle(): Promise<void>
  dispose(): Promise<void>
}

export const MANIFEST_FILE = 'cate-panel.json'

type Scanned = { entry: AppEntry; manifest?: AppManifest }

export function createAppScanner(deps: AppScannerDeps): AppScanner {
  const found = new Map<string, Scanned>()
  const valid = new Map<string, AppManifest>()
  const listListeners = new Set<(entries: AppEntry[]) => void>()
  const pageListeners = new Set<(id: string) => void>()
  let unwatch: (() => void) | undefined
  let offTrust: (() => void) | undefined
  let queue: Promise<void> = Promise.resolve()
  let published = '[]'
  let started: Promise<void> = Promise.resolve()
  let realDir = deps.dir

  const folder = (id: string) => path.join(deps.dir, id)
  const sorted = (): AppEntry[] => [...found.values()].map((scanned) => scanned.entry).sort((a, b) => a.id.localeCompare(b.id))

  async function scanOne(id: string): Promise<Scanned | undefined> {
    const stat = await fs.promises.lstat(folder(id)).catch(() => undefined)
    if (!stat?.isDirectory() && !stat?.isSymbolicLink()) return undefined
    if (!deps.trust.isTrusted()) return { entry: { id, status: 'blocked', warnings: [] } }
    // The page server never follows a link out of a panel's folder, and the watcher
    // reports real paths: a linked panel would never load or reload. Say so.
    if (stat.isSymbolicLink()) return { entry: { id, status: 'error', error: 'le dossier est un lien symbolique : copier le dossier à la place', warnings: [] } }
    let raw: unknown
    try {
      raw = JSON.parse(await fs.promises.readFile(path.join(folder(id), MANIFEST_FILE), 'utf-8'))
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      const error_ = missing ? `${MANIFEST_FILE} est absent du dossier` : `${MANIFEST_FILE} n’est pas du JSON valide`
      return { entry: { id, status: 'error', error: error_, warnings: [] } }
    }
    const parsed = parseManifest(raw, id)
    if (!parsed.ok) return { entry: { id, status: 'error', error: parsed.error, warnings: [] } }
    const { manifest, warnings } = parsed
    return { manifest, entry: { id, status: 'ready', name: manifest.name, description: manifest.description, icon: manifest.icon, size: manifest.size, warnings, source: 'local' } }
  }

  async function apply(id: string): Promise<boolean> {
    const scanned = await scanOne(id)
    if (!scanned) {
      valid.delete(id)
      return found.delete(id)
    }
    found.set(id, scanned)
    if (scanned.manifest) valid.set(id, scanned.manifest)
    return true
  }

  function publish(): void {
    const entries = sorted()
    const next = JSON.stringify(entries)
    if (next === published) return
    published = next
    for (const listener of [...listListeners]) listener(entries)
  }

  const enqueue = (work: () => Promise<void>): Promise<void> => (queue = queue.then(work, work))

  async function scanAll(): Promise<void> {
    const names = (await fs.promises.readdir(deps.dir, { withFileTypes: true }))
      .filter((item) => (item.isDirectory() || item.isSymbolicLink()) && !item.name.startsWith('.'))
      .map((item) => item.name)
    for (const id of [...found.keys()]) if (!names.includes(id)) await apply(id)
    for (const id of names) await apply(id)
    publish()
  }

  const onEvents = (events: FsEvent[]): Promise<void> => {
    const ids = new Set<string>()
    for (const { path: changed } of events) {
      // The watcher reports real paths: the folder may be reached through a link.
      const relative = [deps.dir, realDir].map((base) => path.relative(base, changed)).find((candidate) => candidate && !candidate.startsWith('..') && !path.isAbsolute(candidate)) ?? ''
      const id = relative.split(path.sep)[0]
      if (id && id !== '..' && !id.startsWith('.') && !path.isAbsolute(relative)) ids.add(id)
    }
    return enqueue(async () => {
      for (const id of ids) {
        const existed = await apply(id)
        if (existed) for (const listener of [...pageListeners]) listener(id)
      }
      publish()
    })
  }

  return {
    start: () =>
      (started = (async () => {
        await fs.promises.mkdir(deps.dir, { recursive: true })
        realDir = await fs.promises.realpath(deps.dir)
        await enqueue(scanAll)
        offTrust = deps.trust.onChange(() => void enqueue(scanAll))
        unwatch = await deps.watch(realDir, onEvents)
      })()),
    ready: () => started.catch(() => {}),
    list: sorted,
    manifest: (id) => valid.get(id),
    subscribe(listener) {
      listListeners.add(listener)
      return () => { listListeners.delete(listener) }
    },
    onPage(listener) {
      pageListeners.add(listener)
      return () => { pageListeners.delete(listener) }
    },
    idle: () => queue,
    async dispose() {
      offTrust?.()
      offTrust = undefined
      unwatch?.()
      unwatch = undefined
      listListeners.clear()
      pageListeners.clear()
      await queue
    }
  }
}
