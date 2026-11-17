import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceSnapshot } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../editor/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>,
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

it('asks for the rebase through the answer op, and shows a refusal above the list', async () => {
  const value = snapshot()
  value.suivi!.sections.aFaire = [{ id: 'n2', title: 'Merger la 12 ?', kind: 'human', meta: [], evidence: null, link: null, links: [], action: { type: 'question', questionId: 'q2', rebase: true } }]
  send.mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Question déjà répondue.' } as never)
  render(value)
  await act(async () => { button('Demander le rebase')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q2', choice: 'rebase' })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Question déjà répondue.')
})
