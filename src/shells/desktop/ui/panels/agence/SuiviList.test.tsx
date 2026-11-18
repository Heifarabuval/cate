import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, NeedRow, QuestionView, SuiviView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const host_ = vi.hoisted(() => ({
  order: [] as string[],
  revealPanel: vi.fn(async (_workspaceId: string, panelId: string) => { host_.order.push(`reveal:${panelId}`); return true }),
  focusPanel: vi.fn((_workspaceId: string, panelId: string | null) => { host_.order.push(`focus:${panelId}`) }),
}))
vi.mock('@client/host', async (original) => ({ ...await original<object>(), revealPanel: host_.revealPanel, focusPanel: host_.focusPanel }))
import SuiviList from './SuiviList'

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
const onOpenUrl = vi.fn()
const send = vi.fn(async (_op: AgenceOp) => ({ ok: true }))
const render = (view: SuiviView, questions: Record<string, QuestionView> = {}, compact = false) => act(() => root.render(
  <SuiviList workspaceId="ws" suivi={view} questions={questions} send={send} onRead={onRead} onRebase={onRebase} onOpenUrl={onOpenUrl} compact={compact} />,
))
const headings = () => [...host.querySelectorAll('h2')].map((h) => h.textContent)

beforeEach(() => {
  ui = installMockClientUi()
  onRead.mockClear()
  onRebase.mockClear()
  onOpenUrl.mockClear()
  send.mockClear()
  host_.order.length = 0
  host_.revealPanel.mockClear()
  host_.focusPanel.mockClear()
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

it('makes the #N of a PR a link that opens in Cate, not in the system browser', () => {
  render(suivi({ reste: [row('p', { kind: 'pr', meta: ['#8', 'débloque C007'], link: { label: '#8', href: 'https://github.com/x/y/pull/8' } })] }))
  const link = host.querySelector('a')!
  expect(link.textContent).toBe('#8')
  expect(link.getAttribute('href')).toBe('https://github.com/x/y/pull/8')
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  act(() => { link.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/x/y/pull/8')
  expect(ui.openExternal).not.toHaveBeenCalled()
  expect(host.textContent).toContain('débloque C007')
})

it('makes the evidence URL of a done need a link, and leaves plain evidence as text', () => {
  render(suivi({ fait: [
    row('e', { meta: ['preuve : https://github.com/x/y/pull/9'], evidence: 'https://github.com/x/y/pull/9' }),
    row('f', { meta: ['preuve : sortie de test 4'], evidence: 'sortie de test 4' }),
  ] }))
  const links = [...host.querySelectorAll('a')]
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://github.com/x/y/pull/9'])
  act(() => links[0].click())
  expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/x/y/pull/9')
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

const questionRow = row('n8', { kind: 'human', title: 'Quel nom ?', action: { type: 'question', questionId: 'q1', rebase: false } })
const questionView: QuestionView = {
  id: 'q1', question: 'Quel nom pour le panneau ?', options: [{ label: 'Agence', detail: '' }, { label: 'Suivi', detail: '' }],
  isMerge: false, locks: [], ghUnknown: false, rebase: false,
}

it('offers « Répondre » on a question line: it opens the question card under the line, and closes it once answered', async () => {
  render(suivi({ aFaire: [questionRow] }), { q1: questionView })
  expect(host.querySelector('textarea')).toBeNull()
  act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Répondre')!.click())
  expect(host.textContent).toContain('Quel nom pour le panneau ?')
  await act(async () => { [...host.querySelectorAll('button')].find((b) => /^Suivi/.test(b.textContent ?? ''))!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q1', choice: 1 })
  expect(host.querySelector('textarea')).toBeNull()
})

it('says whether the question card is open on « Répondre »', () => {
  render(suivi({ aFaire: [questionRow] }), { q1: questionView })
  const reply = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Répondre' && b.hasAttribute('aria-expanded'))!
  expect(reply().getAttribute('aria-expanded')).toBe('false')
  act(() => reply().click())
  expect(reply().getAttribute('aria-expanded')).toBe('true')
  act(() => reply().click())
  expect(reply().getAttribute('aria-expanded')).toBe('false')
})

it('names the rebase button briefly in a narrow column, the full name kept as title and accessible name', () => {
  const conflict = row('q2', { kind: 'human', title: 'Merger la 12 ?', action: { type: 'question', questionId: 'q2', rebase: true } })
  const merge: QuestionView = { ...questionView, id: 'q2', isMerge: true, locks: ['conflit avec la base'], rebase: true }
  render(suivi({ aFaire: [conflict] }), { q2: merge }, true)
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Demander le rebase')).toBe(false)
  const short = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Rebase')!
  expect(short.getAttribute('aria-label')).toBe('Demander le rebase')
  expect(short.getAttribute('title')).toBe('Demander le rebase')
  // The card it opens is compact too.
  act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Répondre')!.click())
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Merger quand même (rebase)'))).toBe(true)
})

it('offers no « Répondre » for a question the snapshot no longer holds (already answered)', () => {
  render(suivi({ aFaire: [questionRow] }), {})
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Répondre')).toBe(false)
})

const linked = (links: NeedRow['links']) => row('l', {
  meta: [`panneau : ${links.map((link) => link.title).join(', ')}`],
  links,
})

it('reveals then focuses the live panel whose title is clicked', async () => {
  render(suivi({ reste: [linked([{ panelId: 'p1', title: 'Impl C002', closed: false }])] }))
  const title = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Impl C002')!
  await act(async () => { title.click() })
  expect(host_.order).toEqual(['reveal:p1', 'focus:p1'])
  expect(host_.revealPanel).toHaveBeenCalledWith('ws', 'p1')
  expect(host_.focusPanel).toHaveBeenCalledWith('ws', 'p1')
})

it('acts on the panel clicked when a line links several', async () => {
  render(suivi({ reste: [linked([
    { panelId: 'p1', title: 'Impl C002', closed: false },
    { panelId: 'p2', title: 'Review lot C', closed: false },
  ])] }))
  expect(host.textContent).toContain('panneau : ')
  const second = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Review lot C')!
  await act(async () => { second.click() })
  expect(host_.order).toEqual(['reveal:p2', 'focus:p2'])
})

it('shows a closed panel by its last known title followed by « fermé », not clickable, never « Introuvable »', async () => {
  render(suivi({ reste: [linked([
    { panelId: 'p1', title: 'Impl C002', closed: true },
    { panelId: 'p2', title: 'Review lot C', closed: false },
  ])] }))
  expect(host.textContent).toContain('Impl C002 · fermé')
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Review lot C'])
  await act(async () => { host.querySelector<HTMLElement>('[data-testid="closed-panel"]')!.click() })
  expect(host_.revealPanel).not.toHaveBeenCalled()
  expect(host.textContent!.toLowerCase()).not.toContain('introuvable')
})

it('waits on « Demander le rebase » before the answer, then says it was taken', async () => {
  let answer!: (refusal: string | null) => void
  onRebase.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
  render(suivi({ aFaire: [row('q2', { kind: 'human', action: { type: 'question', questionId: 'q2', rebase: true } })] }))
  const rebase = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Demander le rebase')!
  await act(async () => { rebase().click(); rebase().click() })
  expect(onRebase).toHaveBeenCalledTimes(1)
  expect(rebase().getAttribute('aria-busy')).toBe('true')
  await act(async () => answer(null))
  expect(rebase().hasAttribute('aria-busy')).toBe(false)
  expect(rebase().getAttribute('aria-disabled')).toBe('true')
  expect(rebase().querySelector('svg.lucide-check')).not.toBeNull()
})

it('shows a refused rebase on the line, ready to try again', async () => {
  onRebase.mockResolvedValueOnce('PR introuvable.')
  render(suivi({ aFaire: [row('q2', { kind: 'human', action: { type: 'question', questionId: 'q2', rebase: true } })] }))
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Demander le rebase')!.click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('PR introuvable.')
  expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Demander le rebase')!.hasAttribute('aria-disabled')).toBe(false)
})

it('fades in a line that moves to another section, and none on the first display', () => {
  const moving = row('m1', { title: 'PR à merger' })
  render(suivi({ aFaire: [moving] }))
  expect(host.querySelector('li')!.className).not.toMatch(/animate-sidebar-view-in/)
  render(suivi({ fait: [moving] }))
  expect(host.querySelector('li')!.className).toMatch(/animate-sidebar-view-in/)
  expect(host.querySelector('li')!.className).toMatch(/motion-reduce:animate-none/)
  render(suivi({ fait: [moving] }))
  expect(host.querySelector('li')!.className).not.toMatch(/animate-sidebar-view-in/)
})
