// Exports a custom panel's folder to one `.cate-panneau` (spec 007 FR-012).
// Reads only: the folder is never written, `out` is written once every check
// passed. No git, no network, no process.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathHasPrefix, pathKey } from '@workspace/files/contract'
import { checkPanel, scanSecrets, serializeBundle, validateFolder, type BundleCodec, type FolderItem, type Panel } from '../contract'

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

export const nodeBundleCodec: BundleCodec = {
  hash: sha256,
  sha256,
  decode(base64) {
    const bytes = Buffer.from(base64, 'base64')
    return bytes.toString('base64') === base64 ? bytes : null
  },
  encode: (bytes) => Buffer.from(bytes).toString('base64')
}

/** Never part of a panel: said to the caller, never read. */
const OMITTED = new Set(['.git', 'node_modules'])

/** The folder's entries by `lstat` (links reported, never followed), `.git/` and `node_modules/` omitted. */
export async function listFolder(folder: string): Promise<{ items: FolderItem[]; omitted: string[] }> {
  const items: FolderItem[] = []
  const omitted: string[] = []
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(path.join(folder, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory() && OMITTED.has(entry.name)) omitted.push(`${child}/`)
      else if (entry.isDirectory()) await walk(child)
      else if (entry.isSymbolicLink()) items.push({ path: child, size: 0, link: true })
      else if (entry.isFile()) items.push({ path: child, size: (await fs.promises.lstat(path.join(folder, child))).size })
    }
  }
  await walk('')
  return { items, omitted: omitted.sort() }
}

/** Checks a folder on disk as the panel `id` (named after the folder by default), reading bytes only once the listing passed. */
export async function readPanel(folder: string, id = path.basename(folder)): Promise<{ ok: true; panel: Panel; omitted: string[]; texts: Array<{ path: string; text: string }> } | { ok: false; error: string }> {
  const listing = await listFolder(folder).catch(() => undefined)
  if (!listing) return { ok: false, error: `le dossier « ${path.basename(folder)} » est absent ou illisible` }
  const error = validateFolder(listing.items)
  if (error) return { ok: false, error }
  // O_NOFOLLOW: a file swapped for a link after the listing is refused, not followed.
  const flag = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  const files = await Promise.all(listing.items.map(async (item) => ({ path: item.path, bytes: new Uint8Array(await fs.promises.readFile(path.join(folder, item.path), { flag })) })))
  const result = checkPanel(id, files, nodeBundleCodec)
  if (!result.ok) return result
  const decoder = new TextDecoder()
  return { ...result, omitted: listing.omitted, texts: files.map((file) => ({ path: file.path, text: decoder.decode(file.bytes) })) }
}

export type ExportResult = { ok: true; out: string; fingerprint: string; omitted: string[] } | { ok: false; error: string }

/** `p` with its nearest existing ancestor resolved through links (the rest may not exist yet). */
async function resolveThroughLinks(p: string): Promise<string> {
  const real = await fs.promises.realpath(p).catch(() => undefined)
  if (real) return real
  const parent = path.dirname(p)
  return parent === p ? p : path.join(await resolveThroughLinks(parent), path.basename(p))
}

export async function exportPanel(options: { folder: string; panneauxDir: string; out: string }): Promise<ExportResult> {
  const folder = path.resolve(options.folder)
  const out = path.resolve(options.out)
  if (pathHasPrefix(pathKey(out), pathKey(folder))) return { ok: false, error: 'le paquet ne peut pas être écrit dans le dossier du panneau' }
  // `--out` is the caller's: never a way to write into the panels folder (SC-003), by a link either.
  const panneaux = await resolveThroughLinks(path.resolve(options.panneauxDir))
  if (pathHasPrefix(pathKey(await resolveThroughLinks(path.dirname(out))), pathKey(panneaux))) return { ok: false, error: 'le paquet ne peut pas être écrit dans le dossier des panneaux' }
  const read = await readPanel(folder)
  if (!read.ok) return { ok: false, error: read.error }
  const secrets = scanSecrets(read.texts)
  if (secrets.length) {
    const where = secrets.map((secret) => `${secret.path}${secret.line ? `:${secret.line}` : ''} (${secret.kind})`).join(', ')
    return { ok: false, error: `export refusé, secret probable : ${where}` }
  }
  // `wx`: an existing file, or a link even dangling, is refused, never overwritten or followed.
  const written = await fs.promises.writeFile(out, serializeBundle(read.panel, nodeBundleCodec), { flag: 'wx' }).then(() => undefined, (err: NodeJS.ErrnoException) => err)
  if (written?.code === 'EEXIST') return { ok: false, error: `« ${out} » existe déjà : choisir un fichier qui n’existe pas, rien n’est écrasé` }
  if (written) return { ok: false, error: `le paquet ne peut pas être écrit dans « ${out} »` }
  return { ok: true, out, fingerprint: read.panel.fingerprint, omitted: read.omitted }
}
