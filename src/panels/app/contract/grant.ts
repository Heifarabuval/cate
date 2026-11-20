// What a user agreed to for a custom panel, and when that agreement stops
// holding (spec 008 D8, Q3). Pure: the hash function is injected (SHA-256 of a
// string, hex), so the contract imports no Node.

import type { AppManifest } from './manifest'

export type Hash = (text: string) => string

/** One file of a panel's folder with the SHA-256 of its bytes. */
export interface FolderFile {
  path: string
  sha256: string
}

/** An accepted grant, stored by the runtime (never in the panel's folder). */
export interface AppGrant {
  appId: string
  /** `local`: written by the user's own agent. `installed`: came from outside. */
  source: 'local' | 'installed'
  origin?: string
  manifestFingerprint: string
  /** Installed panels only. */
  folderFingerprint?: string
  accepted: AppManifest['permissions']
  at: string
}

export interface CurrentFingerprints {
  manifestFingerprint: string
  folderFingerprint?: string
}

export type GrantStatus = 'ok' | 'needs-grant' | 'changed'

/** SHA-256 of the sorted lines `path NUL sha256(content)`. */
export function folderFingerprint(files: readonly FolderFile[], hash: Hash): string {
  const lines = files.map((file) => `${file.path}\0${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return hash(lines.join('\n'))
}

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
      : JSON.stringify(value)

/** What a user accepts in a manifest: id, entry, permissions and tasks. */
export function manifestFingerprint(manifest: AppManifest, hash: Hash): string {
  const { id, entry, permissions, tasks } = manifest
  return hash(canonical({ id, entry, permissions, tasks }))
}

/** A panel the user wrote with their own agent keeps its grant while only its
 *  pages change; an installed one is re-checked on every byte. */
export function grantStatus(grant: AppGrant | undefined, current: CurrentFingerprints): GrantStatus {
  if (!grant) return 'needs-grant'
  if (grant.source === 'local') return grant.manifestFingerprint === current.manifestFingerprint ? 'ok' : 'changed'
  return grant.folderFingerprint !== undefined && grant.folderFingerprint === current.folderFingerprint ? 'ok' : 'changed'
}
