// Puts a shared panel on hold (spec 007 FR-013 to FR-015, FR-021): a folder or
// a `.cate-panneau` is read, checked, then copied into the workspace's
// quarantine `<data>/app-imports/<importId>/`. Nothing here writes into the
// panels folder, serves a page, runs git or opens a URL: installing is a
// human's click (lot 3). The list of pending imports lives in memory and the
// quarantine is emptied when the daemon starts.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathHasPrefix, pathKey } from '@workspace/files/contract'
import { BUNDLE_LIMITS, parseBundle, type AppGrant, type Panel, type PendingImport } from '../contract'
import { nodeBundleCodec, readPanel } from './export'

export type StageResult = { ok: true; importId: string; fingerprint: string } | { ok: false; error: string }

export interface AppImports {
  /** Empties the quarantine: an import never outlives the daemon. */
  start(): Promise<void>
  /** Reads, checks and quarantines `source`. `fingerprint`: the start the sender gave by another channel. */
  stage(source: string, options?: { fingerprint?: string }): Promise<StageResult>
  /** Pending imports younger than 24 h, oldest first. */
  list(): PendingImport[]
  subscribe(listener: (imports: PendingImport[]) => void): () => void
  /** Removes the imports older than 24 h. */
  purge(): Promise<void>
}

export interface AppImportsDeps {
  /** `<data>/app-imports`. */
  dir: string
  /** `~/.cate/panneaux`: read to tell what an install would replace, never written. */
  panneauxDir: string
  grants: { get(appId: string): AppGrant | undefined }
  now?: () => number
}

// A bundle is base64 (4/3) plus paths and hashes: twice the folder limit is ample.
const MAX_BUNDLE_BYTES = BUNDLE_LIMITS.totalBytes * 2

export function createAppImports(deps: AppImportsDeps): AppImports {
  if (pathHasPrefix(pathKey(path.resolve(deps.dir)), pathKey(path.resolve(deps.panneauxDir)))) {
    throw new Error(`app imports cannot live in the panneaux folder: ${deps.dir}`)
  }
  const now = deps.now ?? Date.now
  const pending = new Map<string, PendingImport>()
  const listeners = new Set<(imports: PendingImport[]) => void>()
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => {})
    return next
  }

  const fresh = (item: PendingImport) => now() - Date.parse(item.at) <= BUNDLE_LIMITS.pendingMs
  const list = () => [...pending.values()].filter(fresh)
  const publish = () => {
    const current = list()
    for (const listener of [...listeners]) listener(current)
  }
  const remove = async (importId: string) => {
    pending.delete(importId)
    await fs.promises.rm(path.join(deps.dir, importId), { recursive: true, force: true })
  }

  async function read(source: string): Promise<{ ok: true; panel: Panel } | { ok: false; error: string }> {
    const stat = await fs.promises.stat(source).catch(() => undefined)
    if (!stat) return { ok: false, error: `la source « ${path.basename(source)} » est introuvable` }
    if (stat.isDirectory()) return readPanel(source)
    if (!stat.isFile()) return { ok: false, error: 'la source doit être un dossier ou un fichier .cate-panneau' }
    if (stat.size > MAX_BUNDLE_BYTES) return { ok: false, error: 'le paquet dépasse 20 Mio' }
    return parseBundle(await fs.promises.readFile(source, 'utf-8'), nodeBundleCodec)
  }

  /** What the install would replace in the panels folder, and how its files differ. */
  async function compare(panel: Panel): Promise<Pick<PendingImport, 'replaces' | 'diff'>> {
    const folder = path.join(deps.panneauxDir, panel.id)
    const exists = await fs.promises.lstat(folder).then(() => true, () => false)
    if (!exists) return {}
    const current = await readPanel(folder)
    const replaces = deps.grants.get(panel.id)?.source === 'installed' ? 'installed' : 'local'
    // A folder that no longer passes the checks is compared as empty: everything is added.
    const before = new Map(current.ok ? current.panel.files.map((file) => [file.path, file.sha256]) : [])
    const after = new Map(panel.files.map((file) => [file.path, file.sha256]))
    const diff = {
      added: [...after.keys()].filter((key) => !before.has(key)),
      changed: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)),
      removed: [...before.keys()].filter((key) => !after.has(key))
    }
    return { replaces, diff }
  }

  async function stage(source: string, options: { fingerprint?: string } = {}): Promise<StageResult> {
    const expected = options.fingerprint?.toLowerCase()
    if (expected !== undefined && !/^[0-9a-f]{8,64}$/.test(expected)) return { ok: false, error: '--empreinte doit donner au moins 8 caractères hexadécimaux' }
    await purge()
    const result = await read(path.resolve(source))
    if (!result.ok) return result
    const { panel } = result
    if (expected !== undefined && !panel.fingerprint.startsWith(expected)) return { ok: false, error: `l’empreinte calculée ne commence pas par « ${expected} »` }
    const previous = list().filter((item) => item.appId === panel.id)
    if (list().length - previous.length >= BUNDLE_LIMITS.pending) return { ok: false, error: `${BUNDLE_LIMITS.pending} imports sont déjà en attente : en installer ou en annuler un d’abord` }

    const importId = randomUUID()
    const target = path.join(deps.dir, importId)
    try {
      for (const file of panel.files) {
        const to = path.join(target, file.path)
        // Paths are checked by validateFolder; this is the last guard before a write.
        if (!pathHasPrefix(pathKey(to), pathKey(target))) throw new Error(`path out of the quarantine: ${file.path}`)
        await fs.promises.mkdir(path.dirname(to), { recursive: true })
        await fs.promises.writeFile(to, file.bytes, { flag: 'wx' })
      }
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true })
      return { ok: false, error: `la mise en attente a échoué : ${(error as Error).message}` }
    }
    for (const item of previous) await remove(item.importId)
    pending.set(importId, {
      importId,
      appId: panel.id,
      manifest: panel.manifest,
      source,
      fingerprint: panel.fingerprint,
      files: panel.files.length,
      size: panel.files.reduce((sum, file) => sum + file.bytes.length, 0),
      at: new Date(now()).toISOString(),
      ...(await compare(panel))
    })
    publish()
    return { ok: true, importId, fingerprint: panel.fingerprint }
  }

  async function purge(): Promise<void> {
    const expired = [...pending.values()].filter((item) => !fresh(item))
    for (const item of expired) await remove(item.importId)
    if (expired.length) publish()
  }

  return {
    start: () =>
      serial(async () => {
        pending.clear()
        await fs.promises.rm(deps.dir, { recursive: true, force: true })
        await fs.promises.mkdir(deps.dir, { recursive: true })
      }),
    stage: (source, options) => serial(() => stage(source, options)),
    list,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    purge: () => serial(purge)
  }
}
