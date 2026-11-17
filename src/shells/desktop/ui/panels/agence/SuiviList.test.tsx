import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NeedRow, SuiviView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'
import SuiviList from './SuiviList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, patch: Partial<NeedRow> = {}): NeedRow => ({
  id, title: `Besoin ${id}`, kind: 'task', meta: [], evidence: null, link: null, links: [], action: null, ...patch,
})
const suivi = (sections: Partial<SuiviView['sections']> = {}): SuiviView => ({
  repo: 'cate', agentsActive: 2, readAt: '2026-11-17T10:00:00Z', error: null,
  sections: { bloquant: [], aFaire: [], fait: [], reste: [], ...sections },
})

let host: HTMLDivElement
let root: Root
let ui: ReturnType<typeof installMockClientUi>
const onRead = vi.fn()
const onRebase = vi.fn()
const render = (view: SuiviView) => act(() => root.render(<SuiviList suivi={view} onRead={onRead} onRebase={onRebase} />))
const headings = () => [...host.querySelectorAll('h2')].map((h) => h.textContent)

beforeEach(() => {
  ui = installMockClientUi()
  onRead.mockClear()
  onRebase.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('shows the four sections in order with their counts, empty ones included', () => {
  render(suivi({ bloquant: [row('a')], aFaire: [row('b'), row('c')], fait: [], reste: [row('d')] }))
  expect(headings()).toEqual(['Bloquant (1)', 'À faire par Heifara (2)', 'Fait (0)', 'Reste à faire (1)'])
  expect(host.textContent).toContain('Rien.')
})

it('shows the repository, the active agents and the read error', () => {
  render({ ...suivi(), error: 'Unexpected end of JSON input' })
  expect(host.textContent).toContain('cate')
  expect(host.textContent).toContain('Agents actifs : 2')
  expect(host.textContent).toContain('Unexpected end of JSON input')
})

it('offers « Lire et envoyer » on a draft and opens that draft', () => {
  render(suivi({ aFaire: [row('b', { kind: 'draft', action: { type: 'draft', draftId: 'd1', inFlight: false } })] }))
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Lire et envoyer')!
  act(() => button.click())
  expect(onRead).toHaveBeenCalledWith('d1')
})

it('says a draft is being sent, with no button, while Slack or mail is in flight', () => {
  render(suivi({ aFaire: [row('b', { kind: 'draft', action: { type: 'draft', draftId: 'd2', inFlight: true } })] }))
  expect(host.textContent).toContain("En cours d'envoi")
  expect(host.querySelectorAll('button')).toHaveLength(0)
})

it('keeps a title on one truncated line and its buttons from shrinking (FR-007)', () => {
  render(suivi({ aFaire: [row('b', { title: 'Un titre très long '.repeat(10), action: { type: 'draft', draftId: 'd1', inFlight: false } })] }))
  expect(host.querySelector('[data-testid="need-title"]')!.className).toMatch(/\btruncate\b/)
  expect(host.querySelector('[data-testid="need-actions"]')!.className).toMatch(/\bshrink-0\b/)
  expect(host.querySelector('button')!.className).toMatch(/\bwhitespace-nowrap\b/)
})

it('makes the #N of a PR a link that opens outside the app', () => {
  render(suivi({ reste: [row('p', { kind: 'pr', meta: ['#8', 'débloque C007'], link: { label: '#8', href: 'https://github.com/x/y/pull/8' } })] }))
  const link = host.querySelector('a')!
  expect(link.textContent).toBe('#8')
  expect(link.getAttribute('href')).toBe('https://github.com/x/y/pull/8')
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  act(() => { link.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(ui.openExternal).toHaveBeenCalledWith('https://github.com/x/y/pull/8')
  expect(host.textContent).toContain('débloque C007')
})

it('makes the evidence URL of a done need a link, and leaves plain evidence as text', () => {
  render(suivi({ fait: [
    row('e', { meta: ['preuve : https://github.com/x/y/pull/9'], evidence: 'https://github.com/x/y/pull/9' }),
    row('f', { meta: ['preuve : sortie de test 4'], evidence: 'sortie de test 4' }),
  ] }))
  const links = [...host.querySelectorAll('a')]
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://github.com/x/y/pull/9'])
  expect(host.textContent).toContain('preuve : sortie de test 4')
})

it('shows the linked panels in the meta line', () => {
  render(suivi({ reste: [row('l', { meta: ['panneau : Impl C002'], links: [{ panelId: 'p1', title: 'Impl C002', closed: false }] })] }))
  expect(host.textContent).toContain('panneau : Impl C002')
})

it('offers « Demander le rebase » on a merge greyed by a conflict, and only there', () => {
  render(suivi({ aFaire: [
    row('q2', { kind: 'human', meta: ['Merger grisé : conflit avec la base'], action: { type: 'question', questionId: 'q2', rebase: true } }),
    row('q3', { kind: 'human', meta: ['état GitHub inconnu'], action: { type: 'question', questionId: 'q3', rebase: false } }),
  ] }))
  const buttons = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Demander le rebase')
  expect(buttons).toHaveLength(1)
  expect(host.textContent).toContain('Merger grisé : conflit avec la base')
  expect(host.textContent).toContain('état GitHub inconnu')
  act(() => buttons[0].click())
  expect(onRebase).toHaveBeenCalledWith('q2')
})
