// The manifest of a custom panel (`~/.cate/panneaux/<id>/cate-panel.json`,
// spec 008 D6). One pure parser for the runtime, the client and the CLI: a
// bad manifest is one sentence, an unknown field is a warning.

import { isIconName, type IconName } from '@kernel/interaction/contract'

export interface AppSize {
  width: number
  height: number
}

export interface AppManifest {
  schema: 1
  id: string
  name: string
  description: string
  icon: IconName
  /** Path of the page, relative to the panel's folder. */
  entry: string
  size: AppSize
  permissions: {
    files: { read: string[]; write: string[] }
    /** Hosts the page may call, as a CSP `connect-src` source list. */
    network: string[]
    links: { receive: string[]; emit: string[] }
  }
  tasks: string[]
}

export type ManifestResult =
  | { ok: true; manifest: AppManifest; warnings: string[] }
  | { ok: false; error: string }

export const DEFAULT_APP_ICON: IconName = 'layout-dashboard'
const DEFAULT_SIZE = { width: 900, height: 600 }

// Control characters and the bidirectional overrides: a name is drawn in the menus and the frame.
// Controls, bidi marks, line separators and invisible characters (FR-003).
// U+200C and U+200D stay: they compose emojis and non-Latin scripts (Q6).
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
// A host source of a CSP: no scheme, path, space or `;`, so a value can never
// add a directive. `*.host` and `host:port` are allowed.
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message)
}

function strings(value: unknown, field: string, each?: (item: string) => boolean): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return refuse(`${field} doit être une liste`)
  for (const item of value) {
    if (typeof item !== 'string' || !item || (each && !each(item))) refuse(`${field} contient une valeur invalide`)
  }
  return value as string[]
}

function entryPath(value: unknown): string {
  if (value === undefined) return 'index.html'
  const bad = typeof value !== 'string' || !value || value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\\') || value.split('/').some((part) => part === '..' || part === '.' || part === '')
  return bad ? refuse('entry doit être un chemin relatif au dossier, sans « .. »') : (value as string)
}

function size(value: unknown): AppSize {
  if (value === undefined) return DEFAULT_SIZE
  const ok = isRecord(value) && [value.width, value.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 100 && n <= 5000)
  return ok ? { width: (value as Record<string, number>).width, height: (value as Record<string, number>).height } : refuse('size doit donner width et height entre 100 et 5000')
}

function unknownKeys(value: Record<string, unknown>, known: readonly string[], where: string, warnings: string[]): void {
  for (const key of Object.keys(value)) if (!known.includes(key)) warnings.push(`champ inconnu ignoré : ${where}${key}`)
}

/** Parses the manifest read from `folderName`. Never throws. */
export function parseManifest(raw: unknown, folderName: string): ManifestResult {
  const warnings: string[] = []
  try {
    if (!isRecord(raw)) return refuse('le manifeste doit être un objet JSON')
    if (raw.schema !== 1) refuse('version de format inconnue')
    if (typeof raw.id !== 'string' || !KEBAB.test(raw.id)) refuse('id doit être en kebab-case (a-z, 0-9, tirets)')
    if (raw.id !== folderName) refuse(`id « ${String(raw.id)} » différent du nom du dossier « ${folderName} »`)
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 40 || UNSAFE_TEXT.test(raw.name)) refuse('name doit faire de 1 à 40 caractères, sans retour à la ligne ni caractère de contrôle')
    if (typeof raw.description !== 'string' || !raw.description.trim()) refuse('description doit être une phrase')

    let icon: IconName = DEFAULT_APP_ICON
    if (raw.icon !== undefined) {
      if (isIconName(raw.icon)) icon = raw.icon
      else warnings.push(`icon « ${String(raw.icon)} » inconnue, ${DEFAULT_APP_ICON} utilisée`)
    }

    const permissions = raw.permissions === undefined ? {} : raw.permissions
    if (!isRecord(permissions)) return refuse('permissions doit être un objet')
    const files = permissions.files === undefined ? {} : permissions.files
    if (!isRecord(files)) return refuse('permissions.files doit être un objet')
    const links = permissions.links === undefined ? {} : permissions.links
    if (!isRecord(links)) return refuse('permissions.links doit être un objet')

    const read = strings(files.read, 'permissions.files.read')
    if (files.write !== undefined) {
      strings(files.write, 'permissions.files.write')
      warnings.push('permissions.files.write ignoré : l’écriture de fichiers n’existe pas encore')
    }
    const network = strings(permissions.network, 'permissions.network', (host) => HOST.test(host))
    const receive = strings(links.receive, 'permissions.links.receive', (type) => KEBAB.test(type))
    const emit = strings(links.emit, 'permissions.links.emit', (type) => KEBAB.test(type))
    const tasks = strings(raw.tasks, 'tasks', (id) => KEBAB.test(id))

    unknownKeys(raw, ['schema', 'id', 'name', 'description', 'icon', 'entry', 'size', 'permissions', 'tasks', 'version', 'author'], '', warnings)
    unknownKeys(permissions, ['files', 'network', 'links'], 'permissions.', warnings)
    unknownKeys(files, ['read', 'write'], 'permissions.files.', warnings)
    unknownKeys(links, ['receive', 'emit'], 'permissions.links.', warnings)

    return {
      ok: true,
      warnings,
      manifest: {
        schema: 1,
        id: raw.id as string,
        name: raw.name as string,
        description: raw.description as string,
        icon,
        entry: entryPath(raw.entry),
        size: size(raw.size),
        permissions: { files: { read, write: [] }, network, links: { receive, emit } },
        tasks
      }
    }
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message }
    throw error
  }
}
