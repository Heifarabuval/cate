import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

const full = {
  schema: 1,
  id: 'fusion-excel',
  name: 'Fusion Excel',
  description: 'Prévisualise deux fichiers Excel, les lie par une colonne et les fusionne.',
  icon: 'table',
  entry: 'index.html',
  size: { width: 900, height: 600 },
  permissions: {
    files: { read: ['**/*.xlsx', '**/*.csv'] },
    network: [],
    links: { receive: ['fichier'], emit: ['fusion'] }
  },
  tasks: ['fusion-faite']
}

const error = (raw: unknown, folder = 'fusion-excel') => {
  const result = parseManifest(raw, folder)
  if (result.ok) throw new Error('manifest accepted')
  return result.error
}

describe('parseManifest', () => {
  it('accepts the full example of the spec', () => {
    const result = parseManifest(full, 'fusion-excel')
    expect(result).toEqual({ ok: true, manifest: { ...full, permissions: { ...full.permissions, files: { read: ['**/*.xlsx', '**/*.csv'], write: [] } } }, warnings: [] })
  })

  it('fills the defaults of a minimal manifest', () => {
    const result = parseManifest({ schema: 1, id: 'mini', name: 'Mini', description: 'Un panneau.' }, 'mini')
    if (!result.ok) throw new Error(result.error)
    expect(result.manifest).toMatchObject({
      icon: 'layout-dashboard',
      entry: 'index.html',
      size: { width: 900, height: 600 },
      permissions: { files: { read: [], write: [] }, network: [], links: { receive: [], emit: [] } },
      tasks: []
    })
    expect(result.warnings).toEqual([])
  })

  it('refuses anything that is not an object', () => {
    expect(error(null)).toMatch(/objet/)
    expect(error([])).toMatch(/objet/)
  })

  it('refuses an id that differs from the folder', () => {
    expect(error({ ...full, id: 'autre' })).toMatch(/dossier/)
  })

  it('refuses a folder that is not kebab-case', () => {
    expect(error({ ...full, id: 'Fusion Excel' }, 'Fusion Excel')).toMatch(/kebab-case/)
  })

  it('refuses another schema version', () => {
    expect(error({ ...full, schema: 2 })).toBe('version de format inconnue')
  })

  it('refuses an entry that leaves the folder', () => {
    for (const entry of ['.', './', 'a/./b.html', '../index.html', 'a/../../b.html', '/etc/passwd', 'C:\\x.html', 'a\\..\\b.html', '']) {
      expect(error({ ...full, entry }), entry).toMatch(/entry/)
    }
    expect(parseManifest({ ...full, entry: 'pages/accueil.html' }, 'fusion-excel').ok).toBe(true)
  })

  it('refuses a name over 40 characters, or empty', () => {
    expect(error({ ...full, name: 'x'.repeat(41) })).toMatch(/name/)
    expect(error({ ...full, name: '' })).toMatch(/name/)
    expect(error({ ...full, name: '   ' })).toMatch(/name/)
    expect(error({ ...full, name: 'Deux\nlignes' })).toMatch(/name/)
    expect(error({ ...full, name: 'Fusion\u202eXLSX' })).toMatch(/name/)
    expect(parseManifest({ ...full, name: 'x'.repeat(40) }, 'fusion-excel').ok).toBe(true)
  })

  it('refuses a name with an invisible or line-breaking character (FR-003), and keeps refusing the old ones', () => {
    const nameError = error({ ...full, name: 'x\n' })
    for (const char of ['​', ' ', ' ', '⁠', '⁡', '⁢', '⁣', '⁤', '﻿', '­', '‎', '‮', '⁦', '\u0007']) {
      expect(error({ ...full, name: `Fusion${char}Excel` }), `U+${char.charCodeAt(0).toString(16)}`).toBe(nameError)
    }
  })

  it('accepts a zero width joiner inside a composed emoji (Q6)', () => {
    expect(parseManifest({ ...full, name: 'Équipe 👩‍💻' }, 'fusion-excel').ok).toBe(true)
    expect(parseManifest({ ...full, name: 'می‌خواهم' }, 'fusion-excel').ok).toBe(true)
  })

  it('requires a description', () => {
    expect(error({ ...full, description: undefined })).toMatch(/description/)
  })

  it('refuses a files.read that is not a list', () => {
    expect(error({ ...full, permissions: { files: { read: '**/*.xlsx' } } })).toBe('permissions.files.read doit être une liste')
    expect(error({ ...full, permissions: { files: { read: [3] } } })).toMatch(/permissions.files.read/)
  })

  it('refuses a network host that could break out of the policy', () => {
    for (const host of ["a.com; script-src *", "a.com 'unsafe-eval'", '*', 'https://a.com/x', '']) {
      expect(error({ ...full, permissions: { network: [host] } }), host).toMatch(/permissions.network/)
    }
    const ok = parseManifest({ ...full, permissions: { network: ['api.exemple.fr', '*.exemple.fr', 'localhost:8080'] } }, 'fusion-excel')
    expect(ok.ok).toBe(true)
  })

  it('falls back to the default icon when the name is unknown', () => {
    const result = parseManifest({ ...full, icon: 'inconnue-xyz' }, 'fusion-excel')
    if (!result.ok) throw new Error(result.error)
    expect(result.manifest.icon).toBe('layout-dashboard')
    expect(result.warnings.join(' ')).toMatch(/icon/)
  })

  it('warns about an unknown field without failing', () => {
    const result = parseManifest({ ...full, couleur: 'rouge', version: '1.0.0', permissions: { ...full.permissions, bidule: 1 } }, 'fusion-excel')
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('couleur'),expect.stringContaining('permissions.bidule')]))
  })

  it('ignores files.write and says so', () => {
    const result = parseManifest({ ...full, permissions: { files: { read: [], write: ['out/*.xlsx'] } } }, 'fusion-excel')
    if (!result.ok) throw new Error(result.error)
    expect(result.manifest.permissions.files.write).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/files\.write/)
  })

  it('refuses a task id that is not kebab-case, and a bad size', () => {
    expect(error({ ...full, tasks: ['Fusion faite'] })).toMatch(/tasks/)
    expect(error({ ...full, size: { width: 0, height: 600 } })).toMatch(/size/)
  })
})
