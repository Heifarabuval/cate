import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify } from './suivi'
import type { AgenceState, NeedRow } from './types'

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
  return [...(action.rebase ? [`rebase:${action.questionId}`] : []), `question:${action.questionId}`]
}
const shape = (rows: NeedRow[]) => rows.map((row) => ({ title: row.title, meta: row.meta, actions: actions(row) }))

describe('classify', () => {
  const sections = classify(state, known(state.titles), now)

  it.each([['Bloquant', 'bloquant'], ['À faire par Heifara', 'aFaire'], ['Fait', 'fait'], ['Reste à faire', 'reste']] as const)(
    'gives the lines of page_suivi for %s, in the same order with the same mentions', (name, key) => {
      const reference = expected.find((section) => section.name === name)!
      expect(sections[key]).toHaveLength(reference.count)
      expect(shape(sections[key])).toEqual(reference.needs)
    })

  it('keeps a need blocking for Heifara in his section, not in Bloquant', () => {
    expect(sections.aFaire.map((row) => row.title)).toContain('Bloquant de Heifara')
    expect(sections.bloquant.map((row) => row.title)).not.toContain('Bloquant de Heifara')
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
    expect(rows.find((row) => row.title === 'PR du lot C')?.link).toEqual({ label: '#8', href: 'https://github.com/Heifarabuval/cate/pull/8' })
    expect(rows.find((row) => row.title === 'Issue ouverte')?.link).toEqual({ label: '#7', href: 'https://github.com/Heifarabuval/cate/issues/7' })
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

  it('classifies an empty state into four empty sections', () => {
    expect(classify({ ...state, needs: [], drafts: [], questions: [] }, {}, now)).toEqual({ bloquant: [], aFaire: [], fait: [], reste: [] })
  })
})
