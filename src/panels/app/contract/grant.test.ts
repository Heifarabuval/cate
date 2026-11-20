import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { folderFingerprint, grantSentence, grantStatus, manifestFingerprint, type AppGrant, type CurrentFingerprints } from './grant'
import { parseManifest } from './manifest'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const sha = (content: string) => hash(content)

const manifestOf = (permissions: unknown = { files: { read: ['**/*.xlsx'] } }, tasks: string[] = []) => {
  const result = parseManifest({ schema: 1, id: 'fusion-excel', name: 'Fusion', description: 'Une phrase.', permissions, tasks }, 'fusion-excel')
  if (!result.ok) throw new Error(result.error)
  return result.manifest
}

describe('folderFingerprint', () => {
  const files = [
    { path: 'index.html', sha256: sha('<html>') },
    { path: 'app.js', sha256: sha('run()') }
  ]

  it('is the same for the same folder, whatever the order of the files', () => {
    expect(folderFingerprint(files, hash)).toBe(folderFingerprint([...files].reverse(), hash))
  })

  it('changes when one byte of one file changes', () => {
    const edited = [files[0], { path: 'app.js', sha256: sha('run() ') }]
    expect(folderFingerprint(edited, hash)).not.toBe(folderFingerprint(files, hash))
  })

  it('changes when a file is renamed or added', () => {
    expect(folderFingerprint([files[0], { ...files[1], path: 'main.js' }], hash)).not.toBe(folderFingerprint(files, hash))
    expect(folderFingerprint([...files, { path: 'x.css', sha256: sha('') }], hash)).not.toBe(folderFingerprint(files, hash))
  })

  it('hashes lines of "path NUL sha256" sorted by path', () => {
    const lines = [`app.js\0${sha('run()')}`, `index.html\0${sha('<html>')}`].join('\n')
    expect(folderFingerprint(files, hash)).toBe(hash(lines))
  })
})

describe('manifestFingerprint', () => {
  it('follows id, entry, permissions and tasks, not the name or the key order', () => {
    const base = manifestOf()
    expect(manifestFingerprint({ ...base, name: 'Autre nom', description: 'Autre.' }, hash)).toBe(manifestFingerprint(base, hash))
    expect(manifestFingerprint(manifestOf({ files: { read: ['**/*.csv'] } }), hash)).not.toBe(manifestFingerprint(base, hash))
    expect(manifestFingerprint(manifestOf(undefined, ['fusion-faite']), hash)).not.toBe(manifestFingerprint(base, hash))
    expect(manifestFingerprint({ ...base, entry: 'autre.html' }, hash)).not.toBe(manifestFingerprint(base, hash))
  })
})

describe('grantStatus', () => {
  const manifest = manifestOf()
  const folder = folderFingerprint([{ path: 'index.html', sha256: sha('a') }], hash)
  const local: AppGrant = { appId: 'fusion-excel', source: 'local', manifestFingerprint: manifestFingerprint(manifest, hash), accepted: manifest.permissions, at: '2026-11-20T10:00:00Z' }
  const installed: AppGrant = { ...local, source: 'installed', origin: 'https://exemple.fr/p.git', folderFingerprint: folder }
  const current = (patch: Partial<CurrentFingerprints> = {}): CurrentFingerprints => ({ manifestFingerprint: local.manifestFingerprint, folderFingerprint: folder, ...patch })

  it('needs a grant when there is no entry', () => {
    expect(grantStatus(undefined, current())).toBe('needs-grant')
  })

  it('local: ok while the manifest is unchanged, whatever the other files do', () => {
    expect(grantStatus(local, current({ folderFingerprint: folderFingerprint([{ path: 'index.html', sha256: sha('b') }], hash) }))).toBe('ok')
  })

  it('local: changed when the permissions changed', () => {
    const wider = manifestFingerprint(manifestOf({ files: { read: ['**/*'] } }), hash)
    expect(grantStatus(local, current({ manifestFingerprint: wider }))).toBe('changed')
  })

  it('installed: ok when every byte is the same', () => {
    expect(grantStatus(installed, current())).toBe('ok')
  })

  it('installed: changed when one byte of any file changed, even with the same manifest', () => {
    const other = folderFingerprint([{ path: 'index.html', sha256: sha('a ') }], hash)
    expect(grantStatus(installed, current({ folderFingerprint: other }))).toBe('changed')
  })

  it('installed: changed when the folder fingerprint is missing on either side', () => {
    expect(grantStatus(installed, current({ folderFingerprint: undefined }))).toBe('changed')
    expect(grantStatus({ ...installed, folderFingerprint: undefined }, current())).toBe('changed')
  })
})

describe('describe: no accidental pass', () => {
  it('local entry never reads the folder fingerprint', () => {
    const manifest = manifestOf()
    const entry: AppGrant = { appId: 'fusion-excel', source: 'local', manifestFingerprint: manifestFingerprint(manifest, hash), accepted: manifest.permissions, at: 'x' }
    expect(grantStatus(entry, { manifestFingerprint: entry.manifestFingerprint })).toBe('ok')
  })
})

describe('grantSentence (FR-001)', () => {
  it('says the files the user picks may be sent to every declared host, and promises nothing about files', () => {
    const sentence = grantSentence(manifestOf({ network: ['api.exemple.fr', '*.cdn.fr'] }))
    expect(sentence).toMatch(/les fichiers que vous choisissez/i)
    expect(sentence).toContain('api.exemple.fr, *.cdn.fr')
    expect(sentence).not.toContain('sans accès à vos fichiers')
    expect(sentence).toBe('« Fusion » s’exécute dans un cadre isolé. Les fichiers que vous choisissez ici peuvent être envoyés à api.exemple.fr, *.cdn.fr.')
  })

  it('says it cannot use the internet when no host is declared, still without a promise about files', () => {
    const sentence = grantSentence(manifestOf())
    expect(sentence).toBe('« Fusion » s’exécute dans un cadre isolé. Il ne peut pas utiliser internet.')
    expect(sentence).not.toContain('sans accès à vos fichiers')
  })
})
