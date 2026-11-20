import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActionsState, BoiteActions, Ligne as LigneData, LigneAction } from '@client/boite'
import { installMockClientUi } from '../../../../../test/clientUi'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../editor/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>,
}))
import Ligne from './Ligne'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const KEY = '/a/cate#n1'

const ligne = (action: LigneAction): LigneData => ({
  key: KEY, workspaceId: 'w', panelId: 'p', root: '/a/cate', repo: 'cate', needId: 'n1', title: 'Besoin', blocking: false,
  waitingSince: '2026-11-19T10:00:00Z', action, links: [], enabled: true, reason: null,
})
const options = [{ label: 'Merger', detail: 'rebase' }, { label: 'Non', detail: '' }]
const question = (isMerge = false, extra: Partial<Extract<LigneAction, { type: 'question' }>> = {}): LigneAction =>
  ({ type: 'question', questionId: 'q1', options, isMerge, locks: [], ghUnknown: false, rebase: false, ...extra })
const draft = (extra: Partial<Extract<LigneAction, { type: 'draft' }>> = {}): LigneAction =>
  ({ type: 'draft', draftId: 'd1', kind: 'slack', hash: 'h1', texte: '# Salut\n\n**gras**', inFlight: false, ...extra })
const perm: LigneAction = { type: 'perm', command: 'rm -rf build && echo une-commande-assez-longue-pour-deborder', reason: 'nettoyage', genre: 'hook' }

let host: HTMLDivElement
let root: Root
let ui: ReturnType<typeof installMockClientUi>
let actions: { [K in keyof BoiteActions]: ReturnType<typeof vi.fn> }
const state = (patch: Partial<ActionsState> = {}): ActionsState => ({ busy: new Set(), shown: {}, notices: {}, ...patch })
const render = (action: LigneAction, current: ActionsState = state(), patch: Partial<LigneData> = {}) =>
  act(() => root.render(<Ligne ligne={{ ...ligne(action), ...patch }} now={NOW} actions={actions as unknown as BoiteActions} state={current} />))
const button = (label: string | RegExp) =>
  [...host.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')))
const click = async (label: string | RegExp) => { await act(async () => { button(label)!.click() }) }

beforeEach(() => {
  ui = installMockClientUi()
  actions = {
    getState: vi.fn(), subscribe: vi.fn(),
    answer: vi.fn(async () => ({ ok: true })), merge: vi.fn(async () => ({ ok: true })),
    show: vi.fn(() => ({ ok: true, texte: '# Salut\n\n**gras**' })), send: vi.fn(async () => ({ ok: true })),
    perm: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })), restart: vi.fn(async () => ({ ok: true })),
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// ---- Question (T018)

it('opens a question card: options with the first recommended, then a free answer', async () => {
  render(question())
  expect(host.querySelectorAll('[data-testid="option"]')).toHaveLength(0)
  await click('Répondre')
  const shown = [...host.querySelectorAll('[data-testid="option"]')]
  expect(shown.map((option) => option.textContent)).toEqual(['Merger (Recommandé)rebase', 'Non'])
  expect(host.querySelector('textarea')).not.toBeNull()
})

it('answers with the index of the option clicked, on the key of the line', async () => {
  render(question())
  await click('Répondre')
  await act(async () => { (host.querySelectorAll('[data-testid="option"]')[1] as HTMLButtonElement).click() })
  expect(actions.answer).toHaveBeenCalledWith(KEY, { questionId: 'q1', choice: 1 })
})

it('sends the free answer, trimmed, and it only when there is text', async () => {
  render(question())
  await click('Répondre')
  const submit = () => [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Répondre').at(-1)!
  expect(submit().disabled).toBe(true)
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '  plus tard  ')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { submit().click() })
  expect(actions.answer).toHaveBeenCalledWith(KEY, { questionId: 'q1', libre: 'plus tard' })
})

it('Merger is one action of its own on a merge question', async () => {
  render(question(true))
  await click('Merger')
  await act(async () => { (host.querySelectorAll('[data-testid="option"]')[0] as HTMLButtonElement).click() })
  expect(actions.merge).toHaveBeenCalledWith(KEY, { questionId: 'q1' })
  expect(actions.answer).not.toHaveBeenCalled()
})

it('greys Merger with its reasons: the option becomes « Merger quand même », asked first, naming each lock', async () => {
  render(question(true, { locks: ['n11 : Revue de la PR 12', 'conflit avec la base'], ghUnknown: true }))
  await click('Merger')
  expect(host.textContent).toContain('Merger grisé')
  expect(host.textContent).toContain('n11 : Revue de la PR 12')
  expect(host.textContent).toContain('état GitHub inconnu')
  const first = host.querySelectorAll('[data-testid="option"]')[0] as HTMLButtonElement
  expect(first.textContent).toContain('Merger quand même (rebase)')
  ui.confirm.mockResolvedValueOnce(false)
  await act(async () => { first.click() })
  expect(actions.merge).not.toHaveBeenCalled()
  ui.confirm.mockResolvedValueOnce(true)
  await act(async () => { first.click() })
  expect((ui.confirm.mock.calls as unknown as string[][])[0][0]).toContain('conflit avec la base')
  expect(actions.merge).toHaveBeenCalledWith(KEY, { questionId: 'q1', force: true })
})

it('offers « Demander le rebase » on a conflict, only then', async () => {
  render(question(true, { locks: ['conflit avec la base'], rebase: true }))
  await click('Merger')
  await click('Demander le rebase')
  expect(actions.answer).toHaveBeenCalledWith(KEY, { questionId: 'q1', choice: 'rebase' })
  render(question(true))
  expect(button('Demander le rebase')).toBeUndefined()
})

it('shows « envoi en cours » for a busy line and its buttons take no click', async () => {
  render(question(), state({ busy: new Set([KEY]) }))
  expect(host.textContent).toContain('Envoi en cours')
  expect(button('Répondre')!.disabled).toBe(true)
  await click('Répondre')
  expect(actions.answer).not.toHaveBeenCalled()
})

it('shows the refusal of the line in the card', () => {
  render(question(), state({ notices: { [KEY]: 'Question déjà répondue.' } }))
  expect(host.textContent).toContain('Question déjà répondue.')
})

// ---- Draft (T022)

it('reads the draft first: the text is rendered, and Envoyer only then', async () => {
  render(draft())
  expect(button('Envoyer')).toBeUndefined()
  await click('Lire et envoyer')
  expect(actions.show).toHaveBeenCalledWith(KEY)
  expect(actions.send).not.toHaveBeenCalled()
  render(draft(), state({ shown: { [KEY]: 'h1' } }))
  expect(host.querySelector('[data-testid="markdown-preview"]')!.textContent).toBe('# Salut\n\n**gras**')
  expect(button('Envoyer')).toBeDefined()
})

it('Envoyer sends the line whose text is displayed, once per click', async () => {
  render(draft(), state({ shown: { [KEY]: 'h1' } }))
  await click('Envoyer')
  expect(actions.send).toHaveBeenCalledWith(KEY)
  expect(actions.send).toHaveBeenCalledTimes(1)
})

it('shows a conflict of the send in the card (the text changed)', () => {
  render(draft(), state({ notices: { [KEY]: 'texte a changé' } }))
  expect(host.textContent).toContain('texte a changé')
  expect(button('Envoyer')).toBeUndefined()
})

it('a draft being sent says so and offers nothing', () => {
  render(draft({ inFlight: true }))
  expect(host.textContent).toContain("En cours d'envoi")
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['cate'])
})

// ---- Permission (T024)

it('shows the whole command and its reason, with Non then Oui', () => {
  render(perm)
  expect(host.textContent).toContain('rm -rf build && echo une-commande-assez-longue-pour-deborder')
  expect(host.textContent).toContain('nettoyage')
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['cate', 'Non', 'Oui'])
  expect(host.querySelector('code')!.className).toContain('break-all')
})

it('Oui and Non relay the answer on the key of the line', async () => {
  render(perm)
  await click('Oui')
  await click('Non')
  expect(actions.perm.mock.calls).toEqual([[KEY, 'oui'], [KEY, 'non']])
})

it("shows the regisseur's refusal in the card", () => {
  render(perm, state({ notices: { [KEY]: 'La demande a changé ou disparu : recharge le suivi, relis, puis réponds.' } }))
  expect(host.textContent).toContain('La demande a changé ou disparu')
})

it('a line with no readable request has no action button', () => {
  render({ type: 'link' })
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['cate'])
})

// ---- Sauts vers le projet et les panneaux (T028)

const links = [{ panelId: 'x1', title: 'Impl n12', closed: false }, { panelId: 'x2', title: 'Revue n13', closed: false }, { panelId: 'x3', title: 'Vieux agent', closed: true }]

it("jumps to the project's agence panel when its name is clicked", async () => {
  render({ type: 'link' })
  await click('cate')
  expect(actions.open).toHaveBeenCalledWith(KEY)
})

it('jumps to the panel clicked among several, by its id', async () => {
  render({ type: 'link' }, state(), { links })
  await click('Revue n13')
  expect(actions.open).toHaveBeenCalledTimes(1)
  expect(actions.open).toHaveBeenCalledWith(KEY, 'x2')
})

it('shows a closed panel by its last title and « fermé », not clickable, never « Introuvable »', async () => {
  render({ type: 'link' }, state(), { links })
  expect(host.textContent).toContain('Vieux agent · fermé')
  expect(button('Vieux agent · fermé')).toBeUndefined()
  expect(button(/Vieux agent/)).toBeUndefined()
  expect(host.textContent).not.toMatch(/introuvable/i)
})

it('shows the refusal of a jump on the line', async () => {
  actions.open.mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'panneau introuvable' })
  render({ type: 'link' }, state(), { links })
  await click('Impl n12')
  expect(host.textContent).toContain('panneau introuvable')
})

// ---- Projet grisé et Relancer (T031, T033)

const greyed = { enabled: false, reason: 'régisseur arrêté : port pris' }

it('greys a line whose project does not run: the reason, no action, only the links and Relancer', async () => {
  render(question(), state(), { ...greyed, links })
  expect(host.textContent).toContain('régisseur arrêté : port pris')
  expect(host.querySelector('[data-testid="ligne"]')?.className).toContain('opacity-')
  expect(button('Répondre')).toBeUndefined()
  expect(button('Relancer')).toBeDefined()
  expect(button('Impl n12')).toBeDefined()
  await click('Impl n12')
  expect(actions.open).toHaveBeenCalledWith(KEY, 'x1')
})

it.each([
  ['a draft', draft()],
  ['a merge', question(true)],
  ['a permission', perm],
])('offers no action on a greyed line: %s', (_name, action) => {
  render(action, state(), greyed)
  const labels = [...host.querySelectorAll('button')].map((b) => b.textContent)
  expect(labels).toEqual(['cate', 'Relancer'])
})

it("restarts the project's regisseur from its own panel, once per click", async () => {
  let release: (value: unknown) => void = () => {}
  actions.restart.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  render({ type: 'link' }, state(), greyed)
  await click('Relancer')
  expect(actions.restart).toHaveBeenCalledWith({ workspaceId: 'w', panelId: 'p' })
  expect(button('Relancer')?.disabled).toBe(true)
  await act(async () => { release({ ok: true }) })
  expect(actions.restart).toHaveBeenCalledTimes(1)
})

it('says why a restart was refused', async () => {
  actions.restart.mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'orchestrator-failed' })
  render({ type: 'link' }, state(), greyed)
  await click('Relancer')
  expect(host.textContent).toContain('orchestrator-failed')
})

it('has no Relancer on a line that runs', () => {
  render(question())
  expect(button('Relancer')).toBeUndefined()
})
