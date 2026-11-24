import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify } from './suivi'
import type { AgenceState, NeedRow, StateNeed } from './types'

// The fixtures come from agence.py: `etat.json` is an agence state built with
// `add_need` and the clock it was rendered at (GitHub states are fresh or
// stale against it), `sections.json` what `page_suivi` renders for it (title,
// meta mentions and actions of each line, by section).
const fixture = <T>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')) as T
const { now, state } = fixture<{ now: number; state: AgenceState }>('etat.json')
const expected = fixture<Array<{ name: string; count: number; needs: Array<{ title: string; meta: string[]; actions: string[] }> }>>('sections.json')

const known = (titles: Record<string, string>) =>
  Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { title, closed: false }]))
const actions = ({ action }: NeedRow): string[] => {
  if (!action) return []
  if (action.type === 'draft') return [`draft:${action.draftId}`]
  if (action.type !== 'question') return [action.type]
  return [...(action.rebase ? [`rebase:${action.questionId}`] : []), `question:${action.questionId}`]
}
const shape = (rows: NeedRow[]) => rows.map((row) => ({ title: row.title, meta: row.meta, actions: actions(row) }))

describe('classify', () => {
  const sections = classify(state, known(state.titles), now)

  it.each([['Bloquant', 'bloquant'], ["À faire par L'humain", 'aFaire'], ['Fait', 'fait'], ['Reste à faire', 'reste']] as const)(
    'gives the lines of page_suivi for %s, in the same order with the same mentions', (name, key) => {
      const reference = expected.find((section) => section.name === name)!
      expect(sections[key]).toHaveLength(reference.count)
      expect(shape(sections[key])).toEqual(reference.needs)
    })

  it('keeps a need blocking for the human in their section, not in Bloquant', () => {
    expect(sections.aFaire.map((row) => row.title)).toContain("Bloquant de L'humain")
    expect(sections.bloquant.map((row) => row.title)).not.toContain("Bloquant de L'humain")
  })

  it('caps Fait at 20, newest first, equal dates in state order', () => {
    expect(sections.fait).toHaveLength(20)
    expect(sections.fait.slice(0, 2).map((row) => row.title)).toEqual(['Fait 24', 'Fait 22'])
  })

  it('marks a draft in flight when its statut is envoyer, and a question by its id', () => {
    const actions = Object.fromEntries(sections.aFaire.map((row) => [row.title, row.action]))
    expect(actions['Valider le brouillon issue']).toEqual({ type: 'draft', draftId: 'd1', inFlight: false })
    expect(actions['Slack en cours']).toEqual({ type: 'draft', draftId: 'd2', inFlight: true })
    expect(actions['Choisir le merge']).toEqual({ type: 'question', questionId: 'q1', rebase: false })
  })

  it('links linked panels with their known title and flags a closed one', () => {
    const titles = { ...known(state.titles), p1: { title: 'Impl C002', closed: true } }
    const row = classify(state, titles, now).bloquant.find((need) => need.title === 'PR du lot C')!
    expect(row.links).toEqual([{ panelId: 'p1', title: 'Impl C002', closed: true }])
  })

  it('shows the evidence of a done need only', () => {
    expect(sections.fait[0].evidence).toMatch(/^(https:|sortie)/)
    expect(sections.bloquant.every((row) => row.evidence === null)).toBe(true)
  })

  it('links the #N of a PR or an issue to GitHub when the repository is known, and only then', () => {
    const rows = [...sections.bloquant, ...sections.reste]
    expect(rows.find((row) => row.title === 'PR du lot C')?.link).toEqual({ label: '#8', href: 'https://github.com/exemple/depot/pull/8' })
    expect(rows.find((row) => row.title === 'Issue ouverte')?.link).toEqual({ label: '#7', href: 'https://github.com/exemple/depot/issues/7' })
    expect(rows.find((row) => row.title === 'Tâche simple')?.link).toBeNull()
    const noRepo = classify({ ...state, ghRepo: null }, known(state.titles), now)
    expect([...noRepo.bloquant, ...noRepo.reste].every((row) => row.link === null)).toBe(true)
  })

  it('greys Merger with its reasons, offers the rebase on a conflict, and says when the GitHub state is stale', () => {
    const rows = Object.fromEntries(sections.aFaire.map((row) => [row.title, row]))
    expect(rows['Merger la 12 ?'].meta).toEqual(['Merger grisé : n11 : Revue de la PR 12 ; conflit avec la base'])
    expect(rows['Merger la 12 ?'].action).toEqual({ type: 'question', questionId: 'q2', rebase: true })
    expect(rows['Merger la 13 ?'].action).toEqual({ type: 'question', questionId: 'q3', rebase: false })
    expect(rows['Merger la 14 ?'].meta).toEqual(['état GitHub inconnu'])
    // Ten minutes later every GitHub state is stale: no motif, no rebase.
    const later = classify(state, known(state.titles), now + 600_000).aFaire
    expect(later.find((row) => row.title === 'Merger la 12 ?')!.meta).toEqual(['état GitHub inconnu', 'Merger grisé : n11 : Revue de la PR 12'])
    expect(later.find((row) => row.title === 'Merger la 12 ?')!.action).toMatchObject({ rebase: false })
  })

  it('tells when a draft was last edited', () => {
    expect(sections.aFaire.find((row) => row.title === 'Valider le brouillon issue')!.meta).toEqual(['modifié à 14:05'])
  })

  it('ignores the budget fields of an older state: an overrun blocks nothing and says nothing', () => {
    const need = state.needs.find((candidate) => candidate.status === 'open' && candidate.owner !== 'heifara' && !candidate.blocking && !candidate.agentBlocked && !candidate.closeFailed)!
    const old = { ...need, budgetMin: 1, budgetUsd: 2, overBudget: true, overBudgetUsd: true, costByPanel: { a1: 2.4 } }
    const out = classify({ ...state, needs: [old] } as AgenceState, {}, now)
    expect(out.bloquant).toHaveLength(0)
    expect(out.reste.flatMap((row) => row.meta).join()).not.toContain('dépassé')
  })

  it("carries each need's creation time, for the inbox's cross-project sort", () => {
    const first = state.needs.find((need) => need.status === 'open' && need.owner === 'heifara')!
    expect(sections.aFaire.find((row) => row.id === first.id)!.created).toBe(first.created)
    for (const row of [...sections.bloquant, ...sections.aFaire, ...sections.fait, ...sections.reste]) expect(typeof row.created).toBe('string')
  })

  it("carries the permission an agent waits on in the need's line, with Oui/Non only when the screen was readable", () => {
    const base = state.needs.find((need) => need.status === 'open' && need.owner !== 'heifara' && !need.blocking)!
    const perm = { genre: 'hook', commande: 'rm -rf build', motif: 'nettoyage', choix: ['oui', 'non'], panel: 'p2' }
    const rowOf = (patch: Partial<StateNeed>) => {
      const out = classify({ ...state, needs: [{ ...base, agentBlocked: true, ...patch }] }, {}, now)
      return [...out.bloquant, ...out.reste, ...out.fait][0]
    }
    expect(rowOf({ perm }).perm).toEqual({ genre: 'hook', commande: 'rm -rf build', motif: 'nettoyage', choix: true })
    expect(rowOf({ perm: { ...perm, choix: [] } }).perm).toMatchObject({ choix: false })
    // Already answered: the regisseur hides its buttons, so does the line.
    expect(rowOf({ perm, permAnswered: 'abc' }).perm).toMatchObject({ choix: false })
    expect(rowOf({ perm: null }).perm).toBeNull()
    expect(rowOf({ perm, agentBlocked: false }).perm).toBeNull()
    expect(rowOf({ perm, status: 'done' }).perm).toBeNull()
  })

  it('classifies an empty state into four empty sections', () => {
    expect(classify({ ...state, needs: [], drafts: [], questions: [] }, {}, now)).toEqual({ bloquant: [], aFaire: [], fait: [], reste: [] })
  })
})

describe('offers of the regisseur (issue 207)', () => {
  const need = (id: string, extra: object) => ({ ...state.needs[0], id, kind: 'human', ref: null, owner: 'heifara', status: 'open', title: id, panels: [], agentBlocked: false, perm: null, ...extra })
  const sections = classify({ ...state, needs: [
    need('n90', { worktree: { path: '/x/n9-impl', branch: 'feat/x' } }),
    need('n91', { orphan: { panel: 'p9', title: 'T' } }),
    need('n92', { worktree: { path: '/x/n8-impl', branch: 'feat/y' }, status: 'done' }),
  ] } as AgenceState, {}, now)

  it('gives the worktree and the orphan panel an action the views draw as buttons', () => {
    expect(sections.aFaire.map((row) => [row.id, row.action])).toEqual([['n90', { type: 'worktree', branch: 'feat/x' }], ['n91', { type: 'orphan' }]])
  })

  it('offers nothing on a need that is closed', () => {
    expect(sections.fait.find((row) => row.id === 'n92')!.action).toBeNull()
  })
})

describe('a draft that can no longer leave (issue 201)', () => {
  it('says « périmé » with the reason the regisseur read, on the draft line', () => {
    const need = { ...state.needs[0], id: 'n95', kind: 'draft', ref: 'd95', owner: 'heifara', status: 'open', title: 'Valider le brouillon', panels: [], agentBlocked: false, perm: null }
    const draft = { id: 'd95', needId: 'n95', cible: 'pr:o/r:main:fix/x', titre: 'T', statut: 'à valider', url: null }
    const meta = (perime: string | null) => classify({ ...state, needs: [need], drafts: [{ ...draft, perime }] } as AgenceState, {}, now).aFaire[0].meta
    expect(meta('branche fix/x non poussée sur o/r')).toContain('périmé : branche fix/x non poussée sur o/r')
    expect(meta(null).some((item) => item.startsWith('périmé'))).toBe(false)
  })
})

describe('why no merge card comes yet (issue 198)', () => {
  const need = (extra: object) => ({ ...state.needs[0], id: 'n96', kind: 'task', ref: null, owner: 'agent', status: 'open', title: 'Corriger', panels: [], agentBlocked: false, perm: null, blocking: false, overBudget: false, closeFailed: false, ...extra })
  const meta = (extra: object) => {
    const sections = classify({ ...state, needs: [need(extra)] } as AgenceState, {}, now)
    return [...sections.reste, ...sections.fait][0].meta
  }

  it('says what the end condition of an open need still waits for', () => {
    expect(meta({ manques: ['PR non mergée', 'checks non verts'] })).toContain('manque : PR non mergée, checks non verts')
  })

  it('says nothing once the need is done, or when nothing is missing', () => {
    expect(meta({ manques: ['PR non mergée'], status: 'done' }).some((item) => item.startsWith('manque'))).toBe(false)
    expect(meta({ manques: [] }).some((item) => item.startsWith('manque'))).toBe(false)
  })
})
