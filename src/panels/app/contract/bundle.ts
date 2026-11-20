// A shared custom panel (spec 007, FR-011 to FR-015): one JSON file
// `<id>.cate-panneau` holding the folder (path, size, SHA-256, base64 bytes).
// Pure: the same rules check a folder read from disk and a bundle from a third
// party, before anything is written. Hashing and base64 are injected.

import { folderFingerprint, type Hash } from './grant'
import { parseManifest, type AppManifest } from './manifest'

export const BUNDLE_EXTENSION = '.cate-panneau'
const MANIFEST = 'cate-panel.json'
const MIB = 1024 * 1024

/** Starting values without measurement (spec 007 Q10), adjustable without changing the format. */
export const BUNDLE_LIMITS = {
  files: 200,
  fileBytes: 2 * MIB,
  totalBytes: 10 * MIB,
  /** Pending imports per workspace. */
  pending: 10,
  pendingMs: 24 * 60 * 60 * 1000
} as const

export interface BundleCodec {
  /** SHA-256 of a string, hex (as `folderFingerprint` wants it). */
  hash: Hash
  sha256(bytes: Uint8Array): string
  /** Strict base64: null when the text is not the canonical encoding of some bytes. */
  decode(base64: string): Uint8Array | null
  encode(bytes: Uint8Array): string
}

export interface PanelFile {
  path: string
  bytes: Uint8Array
  sha256: string
}

/** A checked panel: valid manifest, safe paths, within the limits; files sorted by path. */
export interface Panel {
  id: string
  manifest: AppManifest
  fingerprint: string
  files: PanelFile[]
}

export type PanelResult = { ok: true; panel: Panel } | { ok: false; error: string }

/** One entry of a folder read with `lstat`. */
export interface FolderItem {
  path: string
  size: number
  link?: boolean
}

/** Where a probable secret is; never its value. */
export interface SecretFound {
  path: string
  /** Absent when the file's name is the finding. */
  line?: number
  kind: string
}

/** An import waiting for a human's click (`<data>/app-imports/<importId>/`). */
export interface PendingImport {
  importId: string
  appId: string
  manifest: AppManifest
  /** The source as the caller named it: a folder or a bundle path. */
  source: string
  fingerprint: string
  files: number
  size: number
  at: string
  /** What an install would replace: a panel with no `installed` grant, or an installed one. */
  replaces?: 'local' | 'installed'
  diff?: { added: string[]; changed: string[]; removed: string[] }
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

// What a sentence may echo of a third party's path: no control, bidi or invisible character.
const show = (value: string) => value.replace(/[^\x20-\x7e\u00a0-\u00ac\u00ae-\u1fff]/g, '?').slice(0, 80)

function badPath(value: string): boolean {
  return (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[a-z]:/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
}

/** The rules a folder and a bundle share: paths, links, case, counts, sizes, manifest present. */
export function validateFolder(items: readonly FolderItem[]): string | null {
  if (items.length > BUNDLE_LIMITS.files) return `le panneau a ${items.length} fichiers, ${BUNDLE_LIMITS.files} au plus`
  const keys = new Map<string, string>()
  let total = 0
  for (const item of items) {
    if (badPath(item.path)) return `chemin refusé : « ${show(item.path)} » (relatif au dossier, sans « .. »)`
    if (item.link) return `« ${show(item.path)} » est un lien symbolique : copier le fichier à la place`
    if (item.size > BUNDLE_LIMITS.fileBytes) return `« ${show(item.path)} » dépasse 2 Mio`
    total += item.size
    const key = item.path.normalize('NFC').toLowerCase()
    const other = keys.get(key)
    if (other !== undefined) return `« ${show(other)} » et « ${show(item.path)} » ne diffèrent que par la casse`
    keys.set(key, item.path)
  }
  if (total > BUNDLE_LIMITS.totalBytes) return 'le panneau dépasse 10 Mio'
  for (const [key, original] of keys) {
    const parts = key.split('/')
    for (let n = 1; n < parts.length; n++) {
      if (keys.has(parts.slice(0, n).join('/'))) return `conflit de chemins : « ${show(original)} » est sous un fichier`
    }
  }
  return keys.has(MANIFEST) ? null : `${MANIFEST} est absent du dossier`
}

/** Checks a panel's files (from a folder named `id`, or a bundle of that `id`) and computes its fingerprint. */
export function checkPanel(id: string, files: ReadonlyArray<{ path: string; bytes: Uint8Array }>, codec: BundleCodec): PanelResult {
  const error = validateFolder(files.map((file) => ({ path: file.path, size: file.bytes.length })))
  if (error) return { ok: false, error }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(files.find((file) => file.path === MANIFEST)!.bytes))
  } catch {
    return { ok: false, error: `${MANIFEST} n’est pas du JSON valide` }
  }
  const parsed = parseManifest(raw, id)
  if (!parsed.ok) return parsed
  const sorted = files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: codec.sha256(file.bytes) })).sort(byPath)
  return { ok: true, panel: { id, manifest: parsed.manifest, fingerprint: folderFingerprint(sorted, codec.hash), files: sorted } }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

interface RawBundle {
  schema: 1
  id: string
  fingerprint: string
  files: Array<{ path: string; size: number; sha256: string; data: string }>
}

function isRawBundle(raw: unknown): raw is RawBundle {
  return (
    isRecord(raw) &&
    raw.schema === 1 &&
    typeof raw.id === 'string' &&
    typeof raw.fingerprint === 'string' &&
    Array.isArray(raw.files) &&
    raw.files.every((file) => isRecord(file) && typeof file.path === 'string' && Number.isSafeInteger(file.size) && (file.size as number) >= 0 && typeof file.sha256 === 'string' && typeof file.data === 'string')
  )
}

/** Reads a `.cate-panneau`: every byte is checked against its SHA-256 and the announced fingerprint. */
export function parseBundle(text: string, codec: BundleCodec): PanelResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'le paquet n’est pas du JSON valide' }
  }
  if (!isRawBundle(raw)) return { ok: false, error: 'le paquet n’a pas le format attendu (schema 1, id, fingerprint, files)' }
  const declared = raw.files
  // Paths and sizes are refused before a byte is decoded.
  const error = validateFolder(declared)
  if (error) return { ok: false, error }
  const files: Array<{ path: string; bytes: Uint8Array }> = []
  for (const file of declared) {
    const bytes = codec.decode(file.data)
    if (!bytes || bytes.length !== file.size || codec.sha256(bytes) !== file.sha256) return { ok: false, error: `« ${show(file.path)} » ne correspond pas à son empreinte` }
    files.push({ path: file.path, bytes })
  }
  const result = checkPanel(raw.id, files, codec)
  if (result.ok && result.panel.fingerprint !== raw.fingerprint) return { ok: false, error: 'l’empreinte annoncée par le paquet est fausse' }
  return result
}

/** The bundle's text: keys in a fixed order, files sorted, no date, so one folder gives one file. */
export function serializeBundle(panel: Panel, codec: BundleCodec): string {
  const files = [...panel.files].sort(byPath).map((file) => ({ path: file.path, size: file.bytes.length, sha256: file.sha256, data: codec.encode(file.bytes) }))
  return `${JSON.stringify({ schema: 1, id: panel.id, fingerprint: panel.fingerprint, files })}\n`
}

const SECRET_NAMES: Array<[RegExp, string]> = [
  [/^\.env/, 'fichier d’environnement'],
  [/\.pem$/i, 'clé ou certificat (.pem)'],
  [/^id_(rsa|dsa|ecdsa|ed25519)/, 'clé SSH']
]

const SECRET_LINES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/, 'jeton GitHub'],
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'clé d’API (sk-)'],
  [/\bAKIA[0-9A-Z]{16}/, 'clé AWS'],
  [/\/(Users|home)\/[^/\s"'`]+\//, 'chemin absolu de la machine']
]

/** Probable secrets of an export (FR-012). It lowers a common mistake, it proves no absence. */
export function scanSecrets(files: ReadonlyArray<{ path: string; text: string }>): SecretFound[] {
  const found: SecretFound[] = []
  for (const file of files) {
    const name = file.path.split('/').pop() ?? ''
    const byName = SECRET_NAMES.find(([pattern]) => pattern.test(name))
    if (byName) {
      found.push({ path: file.path, kind: byName[1] })
      continue
    }
    file.text.split('\n').forEach((line, index) => {
      for (const [pattern, kind] of SECRET_LINES) if (pattern.test(line)) found.push({ path: file.path, line: index + 1, kind })
    })
  }
  return found
}
