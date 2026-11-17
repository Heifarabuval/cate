import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceSnapshot } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../editor/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>,
}))
// The terminal view bound to a PTY: here a stand-in that shows what it was given.
vi.mock('../terminal', () => ({
  TerminalPane: (props: { panelId: string; visible: boolean; snapshot: { ptyId: string | null; status: string } | null; send: (op: unknown) => Promise<unknown> }) => (
    <div data-testid="terminal" data-panel={props.panelId} data-pty={props.snapshot?.ptyId ?? ''} data-status={props.snapshot?.status} data-visible={String(props.visible)}>
      <button type="button" onClick={() => void props.send({ kind: 'restart' })}>terminal retry</button>
    </div>
  ),
}))
import AgenceView from './AgenceView'

const snapshot = (patch: Partial<AgenceSnapshot> = {}): AgenceSnapshot => ({
  ptyId: null, orchestrator: 'running', regisseur: { state: 'running', error: null, settingsHint: null },
  suivi: {
    repo: 'cate', agentsActive: 1, readAt: 't', error: null,
    sections: {
      bloquant: [], fait: [], reste: [],
      aFaire: [{ id: 'n1', title: 'Valider', kind: 'draft', meta: [], evidence: null, link: null, links: [], action: { type: 'draft', draftId: 'd1', inFlight: false } }],
    },
  },
  drafts: { d1: { id: 'd1', cible: 'issue:x/y', kind: 'issue', titre: 'T', statut: 'à valider', texte: 'Texte', hash: 'h' } },
  questions: {},
  ...patch,
})

let host: HTMLDivElement
let root: Root
const send = vi.fn(async (_op: AgenceOp) => ({ ok: true }))
const render = (value: AgenceSnapshot | null) => act(() => root.render(
  <AgenceView workspaceId="ws" panelId="ag1" record={{ id: 'ag1', type: 'agence', title: 'Agence', fields: {} }} session={null as never} send={send} snapshot={value} visible focused={false} />,
))
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)

beforeEach(() => {
  installMockClientUi()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('waits for the first snapshot', () => {
  render(null)
  expect(host.textContent).toContain('Loading agence panel')
})

it('says so when there is no follow-up yet', () => {
  render(snapshot({ suivi: null }))
  expect(host.textContent).toContain('Aucun suivi')
})

it('opens the draft to read from the list and comes back from it', () => {
  render(snapshot())
  act(() => button('Lire et envoyer')!.click())
  expect(host.querySelector('[data-testid="markdown-preview"]')!.textContent).toBe('Texte')
  act(() => button('Retour')!.click())
  expect(host.querySelector('h2')).not.toBeNull()
})

it('goes back to the list when the draft being read is gone (sent or dropped elsewhere)', () => {
  render(snapshot())
  act(() => button('Lire et envoyer')!.click())
  render(snapshot({ drafts: {} }))
  expect(host.querySelector('[data-testid="markdown-preview"]')).toBeNull()
  expect(host.textContent).toContain('À faire par Heifara')
})

/** A ResizeObserver stand-in: `resize` reports the view's width. */
function stubResizeObserver() {
  const callbacks: Array<(entries: unknown[]) => void> = []
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(callback: (entries: unknown[]) => void) { callbacks.push(callback) }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  return { resize: (width: number) => act(() => { for (const callback of callbacks) callback([{ contentRect: { width } }]) }) }
}

it('binds the terminal column to the orchestrator PTY of the snapshot, in this panel\'s name', () => {
  render(snapshot({ ptyId: 'pty-9' }))
  const terminal = host.querySelector('[data-testid="terminal"]')!
  expect(terminal.getAttribute('data-pty')).toBe('pty-9')
  expect(terminal.getAttribute('data-status')).toBe('running')
  expect(terminal.getAttribute('data-panel')).toBe('ag1')
})

it.each([['starting', 'starting'], ['failed', 'failed'], ['exited', 'exited']] as const)('shows an orchestrator that is %s as such in the terminal', (orchestrator, status) => {
  render(snapshot({ orchestrator }))
  expect(host.querySelector('[data-testid="terminal"]')!.getAttribute('data-status')).toBe(status)
})

it.each(['exited', 'failed'] as const)('offers « Relancer l\'orchestrateur » when it is %s, and only then', async (orchestrator) => {
  render(snapshot({ orchestrator: 'running' }))
  expect(button('Relancer l\'orchestrateur')).toBeUndefined()
  render(snapshot({ orchestrator }))
  await act(async () => { button('Relancer l\'orchestrateur')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'orchestrator.restart' })
})

it('turns the terminal\'s own retry into the restart op, and shows a refusal', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'orchestrator-failed' } as never)
  render(snapshot({ orchestrator: 'failed' }))
  await act(async () => { button('terminal retry')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'orchestrator.restart' })
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('orchestrator-failed')
})

it('shows the CLI settings hint of the regisseur', () => {
  render(snapshot({ regisseur: { state: 'running', error: null, settingsHint: 'réglages CLI du workspace à activer dans Cate : panneaux' } }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')!.textContent).toContain('réglages CLI du workspace à activer dans Cate : panneaux')
})

it('says agence is missing, with its message, and offers no follow-up', () => {
  render(snapshot({ suivi: null, regisseur: { state: 'missing', error: 'agence introuvable (agence)', settingsHint: null } }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')!.textContent).toContain('agence introuvable (agence)')
  expect(host.textContent).not.toContain('Régisseur arrêté')
})

it('says the follow-up is read only when another regisseur already serves the repository', () => {
  render(snapshot({ regisseur: { state: 'external', error: 'régisseur déjà actif sur 4321', settingsHint: null } }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')!.textContent).toMatch(/lecture seule/)
})

it('says the regisseur stopped, with its reason, and restarts it on demand', async () => {
  render(snapshot({ regisseur: { state: 'stopped', error: "agence watch s'est arrêté (SIGKILL)", settingsHint: null } }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')!.textContent).toContain("agence watch s'est arrêté (SIGKILL)")
  await act(async () => { button('Relancer le régisseur')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'orchestrator.restart' })
})

it('shows no banner while the regisseur runs or starts', () => {
  render(snapshot())
  expect(host.querySelector('[data-testid="regisseur-banner"]')).toBeNull()
  render(snapshot({ regisseur: { state: 'starting', error: null, settingsHint: null } }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')).toBeNull()
})

it('puts the conversation and the follow-up side by side when there is room', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(1000)
  expect(host.querySelector('[role="tablist"]')).toBeNull()
  expect(host.querySelector('[data-testid="terminal"]')).not.toBeNull()
  expect(host.textContent).toContain('À faire par Heifara')
})

it('switches to the tabs Conversation and Suivi under 640 px, keeping the terminal mounted', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(500)
  const tabs = [...host.querySelectorAll('[role="tab"]')]
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Conversation', 'Suivi'])
  const column = () => host.querySelector('[data-testid="suivi-column"]')!
  expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  expect(column().className).toMatch(/\bhidden\b/)
  expect(host.querySelector('[data-testid="terminal"]')!.getAttribute('data-visible')).toBe('true')
  act(() => (tabs[1] as HTMLElement).click())
  expect(column().className).not.toMatch(/\bhidden\b/)
  expect(host.querySelector('[data-testid="terminal"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="terminal"]')!.getAttribute('data-visible')).toBe('false')
})

it('asks for the rebase through the answer op, and shows a refusal above the list', async () => {
  const value = snapshot()
  value.suivi!.sections.aFaire = [{ id: 'n2', title: 'Merger la 12 ?', kind: 'human', meta: [], evidence: null, link: null, links: [], action: { type: 'question', questionId: 'q2', rebase: true } }]
  send.mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Question déjà répondue.' } as never)
  render(value)
  await act(async () => { button('Demander le rebase')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q2', choice: 'rebase' })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Question déjà répondue.')
})
