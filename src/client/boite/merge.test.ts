import { describe, expect, it } from 'vitest'
import type { AgenceSnapshot, NeedRow, SuiviSections } from '@panels/agence/contract'
import { merge } from './merge'
import type { ProjectInput } from './types'

const need = (id: string, extra: Partial<NeedRow> = {}): NeedRow => ({
  id,
  title: `Besoin ${id}`,
  kind: 'human',
  meta: [],
  evidence: null,
  link: null,
  links: [],
  action: null,
  created: '2026-11-19T10:00:00+00:00',
  ...extra,
})

const snapshot = (sections: Partial<SuiviSections>, repo = 'cate', regisseur: 'running' | 'stopped' = 'running'): AgenceSnapshot => ({
  ptyId: null,
  orchestrator: 'running',
  regisseur: { state: regisseur, error: null, settingsHint: null },
  suivi: { repo, humain: 'Heifara', agentsActive: 0, readAt: '2026-11-19T12:00:00Z', error: null, sections: { bloquant: [], aFaire: [], fait: [], reste: [], ...sections } },
  drafts: {},
  questions: {},
  garde: 'actif',
})

const project = (root: string, sections: Partial<SuiviSections>, extra: Partial<ProjectInput> & { repo?: string } = {}): ProjectInput => {
  const { repo, ...rest } = extra
  return { workspaceId: `local:${root}`, panelId: `p-${root}`, root, snapshot: snapshot(sections, repo ?? root.split('/').pop()), ...rest }
}

const keys = (inputs: ProjectInput[]) => merge(inputs).rows.map((row) => row.key)

describe('merge', () => {
  it('keys a row root#needId and keeps blocking and "à faire" rows only', () => {
    const rows = merge([project('/a/cate', { bloquant: [need('n1')], aFaire: [need('n2')], fait: [need('n3')], reste: [need('n4')] })]).rows
    expect(rows.map((row) => row.key)).toEqual(['/a/cate#n1', '/a/cate#n2'])
    expect(rows.map((row) => row.blocking)).toEqual([true, false])
    expect(rows[0]).toMatchObject({ needId: 'n1', title: 'Besoin n1', repo: 'cate', root: '/a/cate', workspaceId: 'local:/a/cate', panelId: 'p-/a/cate', waitingSince: '2026-11-19T10:00:00+00:00' })
  })

  it('sorts blocking first, then the oldest wait, then repo, then root', () => {
    const old = '2026-11-18T09:00:00+00:00'
    const recent = '2026-11-19T09:00:00+00:00'
    const inputs = [
      project('/b/zeta', { aFaire: [need('n1', { created: old })] }),
      project('/b/alpha', { aFaire: [need('n1', { created: recent })], bloquant: [need('n2', { created: recent })] }),
      project('/a/alpha', { aFaire: [need('n1', { created: recent })] }),
      project('/c/mid', { bloquant: [need('n9', { created: old })] }),
    ]
    expect(keys(inputs)).toEqual([
      '/c/mid#n9', // blocking, oldest
      '/b/alpha#n2', // blocking, newer
      '/b/zeta#n1', // not blocking, oldest
      '/a/alpha#n1', // same wait: repo alpha, root /a before /b
      '/b/alpha#n1',
    ])
  })

  it('compares waits as times, not as text', () => {
    const inputs = [
      project('/a/x', { aFaire: [need('n1', { created: '2026-11-19T10:00:00+02:00' })] }), // 08:00 UTC
      project('/a/y', { aFaire: [need('n1', { created: '2026-11-19T09:00:00+00:00' })] }),
    ]
    expect(keys(inputs)).toEqual(['/a/x#n1', '/a/y#n1'])
  })

  it('puts a need with no known creation time with the longest waits', () => {
    const inputs = [
      project('/a/x', { aFaire: [need('n1', { created: '2026-11-19T09:00:00+00:00' })] }),
      project('/a/y', { aFaire: [need('n1', { created: undefined })] }),
    ]
    expect(keys(inputs)).toEqual(['/a/y#n1', '/a/x#n1'])
  })

  it('keeps two repositories of the same name apart', () => {
    const inputs = [
      project('/one/app', { aFaire: [need('n1')] }),
      project('/two/app', { aFaire: [need('n1')] }),
    ]
    expect(keys(inputs)).toEqual(['/one/app#n1', '/two/app#n1'])
  })

  it('gives one row per key when two panels watch the same root, from the one whose regisseur runs', () => {
    const stopped = project('/a/cate', { aFaire: [need('n1', { title: 'Vieux' })] }, { panelId: 'stopped', snapshot: snapshot({ aFaire: [need('n1', { title: 'Vieux' })] }, 'cate', 'stopped') })
    const running = project('/a/cate', { aFaire: [need('n1', { title: 'Frais' })] }, { panelId: 'running' })
    for (const inputs of [[stopped, running], [running, stopped]]) {
      const result = merge(inputs)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ title: 'Frais', panelId: 'running' })
      expect(result.projects).toHaveLength(2)
    }
  })

  it('has no row for nothing to do, and still counts the projects', () => {
    const result = merge([project('/a/cate', {}), project('/a/lamif', {}), { workspaceId: 'w', panelId: 'p', root: '/a/new', snapshot: null }])
    expect(result.rows).toEqual([])
    expect(result.projects.map((view) => view.repo)).toEqual(['cate', 'lamif', 'new'])
  })

  it('maps a draft, a question and a bare need to their action', () => {
    const base = snapshot({
      aFaire: [
        need('n1', { action: { type: 'draft', draftId: 'd1', inFlight: true } }),
        need('n2', { action: { type: 'question', questionId: 'q1', rebase: false } }),
        need('n3'),
        need('n4', { action: { type: 'draft', draftId: 'gone', inFlight: false } }),
      ],
    })
    base.drafts = { d1: { id: 'd1', cible: 'x', kind: 'slack', titre: null, statut: 'envoyer', texte: 'salut', hash: 'abc' } }
    base.questions = { q1: { id: 'q1', question: 'Merger ?', options: [{ label: 'Merger', detail: 'oui' }], isMerge: true, locks: [], ghUnknown: false, rebase: false } }
    const rows = merge([{ workspaceId: 'w', panelId: 'p', root: '/a/cate', snapshot: base }]).rows
    expect(rows.map((row) => row.action)).toEqual([
      { type: 'draft', draftId: 'd1', kind: 'slack', hash: 'abc', texte: 'salut', inFlight: true },
      { type: 'question', questionId: 'q1', options: [{ label: 'Merger', detail: 'oui' }], isMerge: true, locks: [], ghUnknown: false, rebase: false },
      { type: 'link' },
      { type: 'link' }, // the draft left the snapshot: nothing to send from here
    ])
  })

  it('carries the locks, the unknown GitHub state and the rebase of a merge question', () => {
    const base = snapshot({ aFaire: [need('n1', { action: { type: 'question', questionId: 'q1', rebase: true } })] })
    base.questions = { q1: { id: 'q1', question: 'Merger ?', options: [{ label: 'Merger', detail: '' }], isMerge: true, locks: ['n11 : Revue', 'conflit avec la base'], ghUnknown: true, rebase: true } }
    const [row] = merge([{ workspaceId: 'w', panelId: 'p', root: '/a/cate', snapshot: base }]).rows
    expect(row.action).toMatchObject({ type: 'question', locks: ['n11 : Revue', 'conflit avec la base'], ghUnknown: true, rebase: true })
  })

  it('offers Oui and Non only for a permission the regisseur could read; else the bare link', () => {
    const perm = { genre: 'hook', commande: 'rm -rf build', motif: 'nettoyage' }
    const rows = merge([project('/a/cate', {
      bloquant: [
        need('n1', { perm: { ...perm, choix: true } }),
        need('n2', { perm: { ...perm, choix: false } }),
        need('n3', { perm: null }),
      ],
    })]).rows
    expect(rows.map((row) => row.action)).toEqual([
      { type: 'perm', command: 'rm -rf build', reason: 'nettoyage', genre: 'hook' },
      { type: 'link' },
      { type: 'link' },
    ])
  })

  it('falls back to the root folder name when no state was read', () => {
    expect(merge([{ workspaceId: 'w', panelId: 'p', root: '/a/b/cate', snapshot: null }]).projects[0].repo).toBe('cate')
  })
})
