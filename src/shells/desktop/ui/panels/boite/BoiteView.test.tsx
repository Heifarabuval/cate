import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BoiteSnapshot, Ligne } from '@client/boite'
import { installMockClientUi } from '../../../../../test/clientUi'
import type { PanelViewProps } from '../../client/host/views'
import { createMemoryShortcutRegistry, installShortcutRegistry } from '@kernel/interaction'
import { registerBoiteActions, runBoiteCommand } from './keyboard'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  snapshot: null as unknown as BoiteSnapshot,
  actions: {} as Record<string, unknown>,
  shown: {} as Record<string, string>,
}))
vi.mock('./useBoite', () => ({ useBoite: () => ({ ...h.snapshot, actions: h.actions, actionsState: { busy: new Set(), shown: h.shown, notices: {} } }) }))
vi.mock('../editor/MarkdownPreview', () => ({ MarkdownPreview: () => null }))
import BoiteView from './BoiteView'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const ligne = (key: string, extra: Partial<Ligne> = {}): Ligne => ({
  key, workspaceId: 'w', panelId: 'p', root: '/a/cate', repo: 'cate', needId: key.split('#')[1], title: `Besoin ${key}`,
  blocking: false, waitingSince: '2026-11-19T10:00:00Z', action: { type: 'link' }, meta: [], links: [], enabled: true, reason: null, ...extra,
})
const project = (repo: string) => ({ workspaceId: `w-${repo}`, panelId: 'p', root: `/a/${repo}`, repo, state: 'live' as const, error: null })

// The view reads the store, not its props.
const props = { panelId: 'pb' } as PanelViewProps
let host: HTMLDivElement
let root: Root
let offActions: () => void
const render = (snapshot: BoiteSnapshot) => {
  h.snapshot = snapshot
  act(() => root.render(<BoiteView {...props} />))
}
const text = () => host.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  installMockClientUi()
  offActions = registerBoiteActions()
  installShortcutRegistry(createMemoryShortcutRegistry())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  offActions()
  vi.useRealTimers()
})

it('lists one « À toi » list, blocking first; a line is its project, need, expected action and age', () => {
  render({
    projects: [project('cate'), project('lamif')],
    closedWorkspaces: 0,
    rows: [
      ligne('/a/cate#n1', { blocking: true, title: 'Choisir la base', action: { type: 'question', questionId: 'q1', options: [], isMerge: false, locks: [], ghUnknown: false, rebase: false }, waitingSince: '2026-11-19T11:30:00Z' }),
      ligne('/a/lamif#n2', { repo: 'lamif', root: '/a/lamif', title: 'Valider le brouillon', action: { type: 'draft', draftId: 'd1', kind: 'slack', hash: 'h', texte: 'Salut', inFlight: false } }),
      ligne('/a/lamif#n3', { repo: 'lamif', root: '/a/lamif', title: 'Merger la 12', action: { type: 'question', questionId: 'q2', options: [], isMerge: true, locks: [], ghUnknown: false, rebase: false }, waitingSince: '2026-11-17T12:00:00Z' }),
    ],
  })
  const headings = [...host.querySelectorAll('h2')].map((heading) => heading.textContent)
  expect(headings).toEqual(['À toi'])
  const lines = [...host.querySelectorAll('[data-testid="ligne"]')]
  expect(lines).toHaveLength(3)
  expect(lines[0].textContent).toContain('cate')
  expect(lines[0].textContent).toContain('Choisir la base')
  expect(lines[0].textContent).toContain('Répondre')
  expect(lines[0].textContent).toContain('30 min')
  expect(lines[1].textContent).toContain('lamif')
  expect(lines[1].textContent).toContain('Lire et envoyer')
  expect(lines[1].textContent).toContain('2 h')
  expect(lines[2].textContent).toContain('Merger')
  expect(lines[2].textContent).toContain('2 j')
})

it('shows a heading only for a section that has lines', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1')] })
  expect([...host.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['À toi'])
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

it('has no button to overflow: a title is truncated, nothing is clickable but the project', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1', { title: 'x'.repeat(300) })] })
  expect(host.querySelector('[data-testid="ligne-titre"]')?.className).toContain('truncate')
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['cate'])
})

it('says when no project is watched at all', () => {
  render({ projects: [], closedWorkspaces: 0, rows: [] })
  expect(text()).toContain('Aucun projet orchestré')
})

const draft = (hash = 'h1'): Ligne['action'] => ({ type: 'draft', draftId: 'd1', kind: 'slack', hash, texte: 'Salut', inFlight: false })
const selected = () => [...host.querySelectorAll('[data-testid="ligne"]')].map((line) => line.getAttribute('aria-selected'))
const keyboard = (...commands: Parameters<typeof runBoiteCommand>[1][]) => act(() => { for (const command of commands) runBoiteCommand('pb', command) })

it('moves the selection with J, K and arrow down, by key', () => {
  h.actions = {}
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1'), ligne('/a/cate#n2'), ligne('/a/cate#n3')] })
  expect(selected()).toEqual([null, null, null])
  keyboard('next')
  expect(selected()).toEqual(['true', null, null])
  keyboard('next', 'skip')
  expect(selected()).toEqual([null, null, 'true'])
  keyboard('previous')
  expect(selected()).toEqual([null, 'true', null])
  // A line arrives above: the selection stays on the same line.
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n0'), ligne('/a/cate#n1'), ligne('/a/cate#n2'), ligne('/a/cate#n3')] })
  expect(selected()).toEqual([null, null, 'true', null])
})

it('Enter shows the selected draft, Cmd+Enter sends it only once shown, and it targets the key', () => {
  const show = vi.fn(() => ({ ok: true, texte: 'Salut' }))
  const send = vi.fn(async () => ({ ok: true }))
  h.actions = { show, send }
  h.shown = {}
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1', { action: draft() }), ligne('/a/cate#n2', { action: draft() })] })
  keyboard('next', 'next', 'send')
  expect(send).not.toHaveBeenCalled()
  expect(show).toHaveBeenCalledWith('/a/cate#n2')
  h.shown = { '/a/cate#n2': 'h1' }
  // A new line reorders the list before the second press.
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n0', { action: draft() }), ligne('/a/cate#n1', { action: draft() }), ligne('/a/cate#n2', { action: draft() })] })
  keyboard('send')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith('/a/cate#n2')
  h.shown = {}
})

it('shows the keys on the inbox', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1')] })
  expect(text()).toMatch(/J.*K/)
  expect(text()).toContain('\u21A9')
})

it('no longer runs a command once the view is gone', () => {
  render({ projects: [project('cate')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1')] })
  act(() => root.unmount())
  expect(runBoiteCommand('pb', 'next')).toBe(false)
  root = createRoot(host)
})

const standing = (repo: string, state: 'unavailable' | 'error', error: string) => ({ ...project(repo), state, error })

it('shows a project still being read, never « Rien ne t\'attend » over it', () => {
  render({ projects: [standing('cate', 'unavailable', 'état en cours de lecture')], closedWorkspaces: 0, rows: [] })
  expect(text()).not.toContain("Rien ne t'attend")
  expect(host.querySelector('[data-testid="projet-attente"]')?.textContent).toContain('cate')
  expect(host.querySelector('[data-testid="projet-attente"]')?.textContent).toContain('état en cours de lecture')
})

it('shows the error of a project whose state is unreadable, as an error', () => {
  render({ projects: [project('lamif'), standing('cate', 'error', 'état illisible')], closedWorkspaces: 0, rows: [] })
  expect(text()).not.toContain("Rien ne t'attend")
  const failed = host.querySelector('[data-testid="projet-erreur"]')
  expect(failed?.textContent).toContain('cate')
  expect(failed?.textContent).toContain('état illisible')
})

it('does not repeat a project that already has a greyed line', () => {
  render({ projects: [standing('cate', 'unavailable', 'régisseur arrêté')], closedWorkspaces: 0, rows: [ligne('/a/cate#n1', { enabled: false, reason: 'régisseur arrêté' })] })
  expect(host.querySelector('[data-testid="projet-attente"]')).toBeNull()
})

it('lists two panels of one root without a duplicate key', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
  render({ projects: [{ ...standing('cate', 'unavailable', 'lecture'), panelId: 'p1' }, { ...standing('cate', 'error', 'illisible'), panelId: 'p2', workspaceId: 'w2' }], closedWorkspaces: 0, rows: [] })
  expect(warn.mock.calls.flat().join(' ')).not.toContain('same key')
  warn.mockRestore()
})

// 320 px is checked by classes, not by pixels (jsdom has no layout): every action keeps its
// size and one line, every free text breaks, the root clips, no color is fixed.
it('holds at 320 px by classes, with the cards open and a stopped project', () => {
  h.actions = {}
  const locks = ['PR 12 : la CI est rouge depuis 3 jours sur une branche longue ' + 'x'.repeat(120)]
  const question = { type: 'question' as const, questionId: 'q1', options: [{ label: 'Merger', detail: 'd'.repeat(200) }, { label: 'Attendre', detail: 'e'.repeat(200) }], isMerge: true, locks, ghUnknown: false, rebase: true }
  const perm = { type: 'perm' as const, command: 'rm -rf ' + 'y'.repeat(200), reason: 'r'.repeat(200), genre: 'bash' }
  render({
    projects: [project('cate')], closedWorkspaces: 0,
    rows: [
      ligne('/a/cate#n1', { action: question, title: 'x'.repeat(300), blocking: true }),
      ligne('/a/cate#n2', { action: perm }),
      ligne('/a/cate#n3', { action: draft(), links: [{ panelId: 'p9', title: 't'.repeat(200), closed: false }] }),
      ligne('/a/cate#n4', { enabled: false, reason: 'régisseur arrêté ' + 'z'.repeat(200) })
    ]
  })
  act(() => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Merger')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const buttons = [...host.querySelectorAll('button')]
  const labels = buttons.map((b) => b.textContent)
  expect(labels).toEqual(expect.arrayContaining(['Demander le rebase', 'Non', 'Oui', 'Relancer', 'Lire et envoyer']))
  for (const button of buttons) {
    const own = button.className
    // An action holds its size on one line; a link clips; an option is a full-width card whose texts break.
    const holds = own.includes('shrink-0') && own.includes('whitespace-nowrap')
    const clips = own.includes('truncate')
    const card = button.dataset.testid === 'option' && button.querySelector('span.break-words, b.break-words') !== null
    expect(holds || clips || card, `${button.textContent} : ${own}`).toBe(true)
  }
  for (const text of ['d'.repeat(200), 'y'.repeat(200), 'r'.repeat(200), 'z'.repeat(200)]) {
    const holder = [...host.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.includes(text))!
    expect(`${holder.className} ${holder.parentElement?.className}`, text.slice(0, 6)).toMatch(/break-(words|all)/)
  }
  expect(host.firstElementChild?.className).toContain('min-w-0')
  expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|(bg|text|border)-(white|black)\b/i)
})
