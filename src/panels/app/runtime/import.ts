// Puts a shared panel on hold (spec 007 FR-013 to FR-015, FR-021): a folder or
// a `.cate-panneau` is read, checked, then copied into the workspace's
// quarantine `<data>/app-imports/<importId>/`. Staging never writes into the
// panels folder, serves a page, runs git or opens a URL. `accept` is a human's
// click in a client (FR-017, FR-018) and the only code that writes into the
// panels folder. The list of pending imports lives in memory and the
// quarantine is emptied when the daemon starts.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathHasPrefix, pathKey } from '@workspace/files/contract'
import type { ClientFeature } from '@kernel/rpc/contract'
import { BUNDLE_LIMITS, folderChanges, manifestFingerprint, parseBundle, type AppGrant, type Panel, type PendingImport } from '../contract'
import { nodeBundleCodec, readPanel } from './export'

export type StageResult = { ok: true; importId: string; fingerprint: string } | { ok: false; error: string }
export type AcceptResult = { ok: true; appId: string } | { ok: false; error: string }

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
  /** Installs a pending import: the card's fingerprint, read again on the quarantined bytes.
   *  `replace`: the explicit choice to replace the panel of that id. */
  accept(card: { importId: string; fingerprint: string; replace?: boolean }, caller: { connectionId: number | null }): Promise<AcceptResult>
  /** Cancels a pending import and empties its quarantine. */
  drop(importId: string): Promise<void>
}

export interface AppImportsDeps {
  /** `<data>/app-imports`. */
  dir: string
  /** `~/.cate/panneaux`: written by `accept` only. */
  panneauxDir: string
  grants: { get(appId: string): AppGrant | undefined; grant(grant: AppGrant): void }
  trust: { isTrusted(): boolean }
  /** Whether the client behind a connection has the feature (`null`: the runtime itself). */
  clientHas(connectionId: number | null, feature: ClientFeature): boolean
  /** Scans the installed panel again once its grant is written. */
  refresh(appId: string): Promise<void>
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
    return { replaces, diff: folderChanges(current.ok ? current.panel.files : [], panel.files) }
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

  async function accept(card: { importId: string; fingerprint: string; replace?: boolean }, caller: { connectionId: number | null }): Promise<AcceptResult> {
    if (caller.connectionId === null) return { ok: false, error: 'seul un client peut installer un panneau perso, jamais le runtime' }
    if (!deps.clientHas(caller.connectionId, 'webview')) return { ok: false, error: 'ce client ne peut pas installer un panneau perso (fonctionnalité webview absente)' }
    if (!deps.trust.isTrusted()) return { ok: false, error: 'workspace non approuvé : le panneau perso ne peut pas être installé' }
    await purge()
    const item = pending.get(card.importId)
    if (!item || !fresh(item)) return { ok: false, error: 'import introuvable ou expiré : relancer l’import' }
    if (card.fingerprint !== item.fingerprint) return { ok: false, error: 'l’empreinte ne correspond pas à la carte : relire la carte' }
    // The bytes installed are the ones read here, checked against the card.
    const read = await readPanel(path.join(deps.dir, item.importId), item.appId)
    if (!read.ok || read.panel.fingerprint !== item.fingerprint) {
      await remove(item.importId)
      publish()
      return { ok: false, error: `l’import a été modifié ou un fichier est absent depuis l’affichage de la carte : relancer l’import${read.ok ? '' : ` (${read.error})`}` }
    }
    const { panel } = read
    const target = path.join(deps.panneauxDir, panel.id)
    const exists = await fs.promises.lstat(target).then(() => true, () => false)
    if (exists && !card.replace) return { ok: false, error: `« ${panel.id} » existe déjà : choisir Remplacer pour l’écraser` }

    // Hidden siblings: the scanner skips names starting with a dot.
    const staging = path.join(deps.panneauxDir, `.import-${item.importId}`)
    const old = path.join(deps.panneauxDir, `.old-${item.importId}`)
    let moved = false
    try {
      for (const file of panel.files) {
        const to = path.join(staging, file.path)
        if (!pathHasPrefix(pathKey(to), pathKey(staging))) throw new Error(`path out of the panel: ${file.path}`)
        await fs.promises.mkdir(path.dirname(to), { recursive: true })
        await fs.promises.writeFile(to, file.bytes, { flag: 'wx' })
      }
      // A rename onto a non-empty folder fails: the old one steps aside until the new one is in.
      if (exists) {
        await fs.promises.rename(target, old)
        moved = true
      }
      await fs.promises.rename(staging, target)
    } catch (error) {
      if (moved) await fs.promises.rename(old, target).catch(() => {})
      await fs.promises.rm(staging, { recursive: true, force: true })
      return { ok: false, error: `l’installation a échoué, rien n’a changé : ${(error as Error).message}` }
    }
    if (moved) await fs.promises.rm(old, { recursive: true, force: true })
    deps.grants.grant({
      appId: panel.id,
      source: 'installed',
      origin: item.source,
      manifestFingerprint: manifestFingerprint(panel.manifest, nodeBundleCodec.hash),
      folderFingerprint: panel.fingerprint,
      files: panel.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      accepted: panel.manifest.permissions,
      at: new Date(now()).toISOString()
    })
    await remove(item.importId)
    publish()
    await deps.refresh(panel.id)
    return { ok: true, appId: panel.id }
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
    purge: () => serial(purge),
    accept: (card, caller) => serial(() => accept(card, caller)),
    drop: (importId) =>
      serial(async () => {
        if (!pending.has(importId)) return
        await remove(importId)
        publish()
      })
  }
}
