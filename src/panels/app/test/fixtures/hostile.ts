// The hostile panels of spec 007 (plan, « Fixtures hostiles du lot 2 »), built
// in memory: a test writes them to its own temporary folder when it needs a
// folder or a `.cate-panneau` file. Nothing personal: generic names only.

import { createHash } from 'node:crypto'
import { folderFingerprint } from '../../contract'

export interface FixtureFile {
  path: string
  data: string | Buffer
  /** A symbolic link to this target instead of a file. */
  link?: string
}

export interface HostileFixture {
  name: string
  /** The folder's name (and the bundle's id). */
  id: string
  files: FixtureFile[]
  /** A fragment of the one sentence that refuses it. */
  error: RegExp
  /** Changes the bundle made from `files`: an object is serialised, a string is the text. */
  tamper?: (bundle: RawBundle) => RawBundle | string
  /** The form it exists in: a bundle cannot hold a link, a disk cannot hold `..`. */
  only?: 'bundle' | 'folder'
  /** Refused only once spec 007 lot 1 (T109, U+200B in `name`) has landed. */
  needsLot1?: boolean
}

export interface RawBundle {
  schema: number
  id: string
  fingerprint: string
  files: Array<{ path: string; size: number; sha256: string; data: string }>
}

const MIB = 1024 * 1024
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hash = (text: string) => sha256(text)

export const manifestText = (id: string, extra: object = {}) =>
  JSON.stringify({ schema: 1, id, name: 'Panneau de test', description: 'Une phrase.', ...extra })

/** A sound panel: manifest, page, script in a subfolder. */
export const soundFiles = (id = 'panneau-sain'): FixtureFile[] => [
  { path: 'cate-panel.json', data: manifestText(id) },
  { path: 'index.html', data: '<!doctype html><script src="js/app.js"></script>' },
  { path: 'js/app.js', data: 'document.body.textContent = "ok"' }
]

/** The bundle of `files`, as `export` writes it (paths sorted, base64 data). */
export function rawBundle(id: string, files: FixtureFile[]): RawBundle {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const entries = sorted.map((file) => {
    const bytes = Buffer.from(file.data)
    return { path: file.path, size: bytes.length, sha256: sha256(bytes), data: bytes.toString('base64') }
  })
  return { schema: 1, id, fingerprint: folderFingerprint(entries, hash), files: entries }
}

export function bundleText(fixture: Pick<HostileFixture, 'id' | 'files' | 'tamper'>): string {
  const raw = rawBundle(fixture.id, fixture.files)
  const tampered = fixture.tamper ? fixture.tamper(raw) : raw
  return typeof tampered === 'string' ? tampered : JSON.stringify(tampered)
}

const id = 'panneau-hostile'
const sound = () => soundFiles(id)

export const HOSTILE: HostileFixture[] = [
  { name: '..', id, files: [...sound(), { path: '../evil.js', data: 'x' }], error: /chemin refusé/, only: 'bundle' },
  { name: 'chemin absolu', id, files: [...sound(), { path: '/tmp/evil.js', data: 'x' }], error: /chemin refusé/, only: 'bundle' },
  { name: 'C:\\', id, files: [...sound(), { path: 'C:\\evil.js', data: 'x' }], error: /chemin refusé/ },
  { name: 'lien symbolique', id, files: [...sound(), { path: 'lien.js', data: '', link: '../../outside.js' }], error: /lien symbolique/, only: 'folder' },
  { name: 'casse', id, files: [...sound(), { path: 'App.js', data: 'a' }, { path: 'app.js', data: 'b' }], error: /casse/, only: 'bundle' },
  { name: 'manifeste absent', id, files: sound().filter((file) => file.path !== 'cate-panel.json'), error: /cate-panel\.json est absent/ },
  { name: 'id différent', id, files: [{ path: 'cate-panel.json', data: manifestText('autre-panneau') }, ...sound().slice(1)], error: /différent du nom du dossier/ },
  { name: 'JSON invalide', id, files: sound(), tamper: () => '{ "schema": 1, ', error: /pas du JSON valide/, only: 'bundle' },
  { name: 'empreinte fausse', id, files: sound(), tamper: (raw) => ({ ...raw, fingerprint: '0'.repeat(64) }), error: /empreinte annoncée/, only: 'bundle' },
  { name: '201 fichiers', id, files: [...sound(), ...Array.from({ length: 198 }, (_, n) => ({ path: `f/${n}.txt`, data: String(n) }))], error: /201 fichiers/ },
  { name: '2 Mio + 1', id, files: [...sound(), { path: 'gros.bin', data: Buffer.alloc(2 * MIB + 1, 1) }], error: /dépasse 2 Mio/ },
  { name: '10 Mio + 1', id, files: [...sound(), ...Array.from({ length: 5 }, (_, n) => ({ path: `part-${n}.bin`, data: Buffer.alloc(2 * MIB, 1) }))], error: /dépasse 10 Mio/ },
  { name: 'nom U+200B', id, files: [{ path: 'cate-panel.json', data: manifestText(id, { name: 'Panneau\u200Bcaché' }) }, ...sound().slice(1)], error: /name doit/, needsLot1: true }
]
