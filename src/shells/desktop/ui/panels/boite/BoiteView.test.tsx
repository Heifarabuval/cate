import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BoiteSnapshot, Ligne } from '@client/boite'
import { installMockClientUi } from '../../../../../test/clientUi'
import type { PanelViewProps } from '../../client/host/views'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ snapshot: null as unknown as BoiteSnapshot }))
vi.mock('./useBoite', () => ({ useBoite: () => h.snapshot }))
import BoiteView from './BoiteView'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const ligne = (key: string, extra: Partial<Ligne> = {}): Ligne => ({
  key, workspaceId: 'w', panelId: 'p', root: '/a/cate', repo: 'cate', needId: key.split('#')[1], title: `Besoin ${key}`,
  blocking: false, waitingSince: '2026-11-19T10:00:00Z', action: { type: 'link' }, links: [], ...extra,
})
const project = (repo: string) => ({ workspaceId: `w-${repo}`, panelId: 'p', root: `/a/${repo}`, repo })

// The view reads the store, not its props.
const props = {} as PanelViewProps
let host: HTMLDivElement
let root: Root
const render = (snapshot: BoiteSnapshot) => {
  h.snapshot = snapshot
  act(() => root.render(<BoiteView {...props} />))
}
const text = () => host.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  installMockClientUi()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

it('lists Bloquant first, then À faire; a line is its project, need, expected action and age', () => {
  render({
    projects: [project('cate'), project('lamif')],
    closedWorkspaces: 0,
    rows: [
      ligne('/a/cate#n1', { blocking: true, title: 'Choisir la base', action: { type: 'question', questionId: 'q1', options: [], isMerge: false }, waitingSince: '2026-11-19T11:30:00Z' }),
      ligne('/a/lamif#n2', { repo: 'lamif', root: '/a/lamif', title: 'Valider le brouillon', action: { type: 'draft', draftId: 'd1', kind: 'slack', hash: 'h', texte: 'Salut', inFlight: false } }),
      ligne('/a/lamif#n3', { repo: 'lamif', root: '/a/lamif', title: 'Merger la 12', action: { type: 'question', questionId: 'q2', options: [], isMerge: true }, waitingSince: '2026-11-17T12:00:00Z' }),
    ],
  })
  const headings = [...host.querySelectorAll('h2')].map((heading) => heading.textContent)
  expect(headings).toEqual(['Bloquant', 'À faire'])
  const lines = [...host.querySelectorAll('[data-testid="ligne"]')]
  expect(lines).toHaveLength(3)
  expect(lines[0].textContent).toContain('cate')
  expect(lines[0].textContent).toContain('Choisir la base')
  expect(lines[0].textContent).toContain('Répondre')
  expect(lines[0].textContent).toContain('30 min')
  expect(lines[1].textContent).toContain('lamif')
  expect(lines[1].textContent).toContain('Envoyer')
  expect(lines[1].textContent).toContain('2 h')
  expect(lines[2].textContent).toContain('Merger')
  expect(lines[2].textContent).toContain('2 j')
})

it('shows a heading only for a section that has lines', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1')] })
  expect([...host.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['À faire'])
})

it('says nothing waits, how many projects are watched and how many workspaces are not open', () => {
  render({ projects: [project('cate'), project('lamif'), project('skills')], closedWorkspaces: 2, rows: [] })
  expect(text()).toContain("Rien ne t'attend")
  expect(text()).toContain('3 projets surveillés')
  expect(text()).toContain('2 workspaces non ouverts')
})

it('keeps the count of unwatched workspaces under a list too, singular included', () => {
  render({ projects: [project('cate')], closedWorkspaces: 1, rows: [ligne('/a/cate#n1')] })
  expect(text()).not.toContain("Rien ne t'attend")
  expect(text()).toContain('1 projet surveillé')
  expect(text()).toContain('1 workspace non ouvert')
})

it('has no button to overflow: a title is truncated, nothing is clickable but panel links', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1', { title: 'x'.repeat(300) })] })
  expect(host.querySelector('[data-testid="ligne-titre"]')?.className).toContain('truncate')
  expect(host.querySelectorAll('button')).toHaveLength(0)
})

it('says when no project is watched at all', () => {
  render({ projects: [], closedWorkspaces: 0, rows: [] })
  expect(text()).toContain('Aucun projet orchestré')
})
