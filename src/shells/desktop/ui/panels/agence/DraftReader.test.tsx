import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceOpResult, DraftView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../editor/MarkdownPreview', () => ({
  MarkdownPreview: ({ content, noImages }: { content: string; noImages?: boolean }) => <div data-testid="markdown-preview" data-no-images={String(noImages === true)}>{content}</div>,
}))
import DraftReader from './DraftReader'

const draft = (patch: Partial<DraftView> = {}): DraftView => ({
  id: 'd1', cible: 'issue:Heifarabuval/cate', kind: 'issue', titre: 'Corriger le suivi', statut: 'à valider',
  texte: '# Titre\n\nCorps **gras**', hash: 'hash-affiché', ...patch,
})

let host: HTMLDivElement
let root: Root
let ui: ReturnType<typeof installMockClientUi>
let send: ReturnType<typeof vi.fn<(op: AgenceOp) => Promise<unknown>>>
const onBack = vi.fn()
const render = (value: DraftView) => act(() => root.render(<DraftReader workspaceId="ws" panelId="ag1" draft={value} send={send} onBack={onBack} />))
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const click = async (label: string) => { await act(async () => { button(label)!.click() }) }

beforeEach(() => {
  ui = installMockClientUi()
  send = vi.fn(async (): Promise<AgenceOpResult> => ({ ok: true }))
  onBack.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('renders the draft text through the markdown preview, with its target and title', () => {
  render(draft())
  expect(host.querySelector('[data-testid="markdown-preview"]')!.textContent).toBe('# Titre\n\nCorps **gras**')
  expect(host.textContent).toContain('Corriger le suivi')
  expect(host.textContent).toContain('issue:Heifarabuval/cate')
})

it('renders the draft without images, and sends its raw text unchanged', async () => {
  const texte = 'Voir ![pixel](https://track.example/p.png)'
  render(draft({ texte }))
  const preview = host.querySelector('[data-testid="markdown-preview"]')!
  expect(preview.getAttribute('data-no-images')).toBe('true')
  expect(preview.textContent).toBe(texte)
  await click('Envoyer')
  expect(send).toHaveBeenCalledWith({ kind: 'draft.send', draftId: 'd1', hash: 'hash-affiché' })
})

it('sends the hash it displayed, and goes back when the send is accepted', async () => {
  render(draft())
  await click('Envoyer')
  expect(send).toHaveBeenCalledWith({ kind: 'draft.send', draftId: 'd1', hash: 'hash-affiché' })
  expect(onBack).toHaveBeenCalledTimes(1)
})

it('asks to edit and to drop through ops, with no dialog', async () => {
  render(draft())
  await click('Modifier')
  expect(send).toHaveBeenLastCalledWith({ kind: 'draft.edit', draftId: 'd1' })
  expect(onBack).not.toHaveBeenCalled()
  await click('Abandonner')
  expect(send).toHaveBeenLastCalledWith({ kind: 'draft.drop', draftId: 'd1' })
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(ui.showError).not.toHaveBeenCalled()
})

it('shows a refusal in the card, keeps the draft open and offers to try again', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'texte a changé' })
  render(draft())
  await click('Envoyer')
  expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/texte a changé/)
  expect(onBack).not.toHaveBeenCalled()
  expect(button('Envoyer')!.disabled).toBe(false)
  expect(ui.confirm).not.toHaveBeenCalled()
})

it.each([
  [{ ok: false, error: 'unavailable', message: 'agence introuvable (agence)' }, /agence introuvable/],
  [{ ok: false, error: 'invalid' }, /introuvable/],
] as const)('says what happened for %j', async (result, text) => {
  send.mockResolvedValueOnce(result)
  render(draft())
  await click('Envoyer')
  expect(host.querySelector('[role="alert"]')!.textContent).toMatch(text)
})

it('sends once on a double click: the buttons wait for the answer', async () => {
  let answer!: (result: AgenceOpResult) => void
  send.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
  render(draft())
  await act(async () => { button('Envoyer')!.click(); button('Envoyer')!.click() })
  expect(send).toHaveBeenCalledTimes(1)
  expect(button('Envoyer')!.getAttribute('aria-disabled')).toBe('true')
  expect(button('Abandonner')!.disabled).toBe(true)
  await act(async () => answer({ ok: true }))
  expect(send).toHaveBeenCalledTimes(1)
})

it('offers no action on a draft already sent or being sent', () => {
  render(draft({ statut: 'envoyer' }))
  expect(button('Envoyer')).toBeUndefined()
  expect(button('Abandonner')).toBeUndefined()
  expect(button('Modifier')).toBeUndefined()
  expect(host.textContent).toContain("En cours d'envoi")
  expect(button('Retour')).toBeDefined()
})

it('goes back without any op', async () => {
  render(draft())
  await click('Retour')
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(send).not.toHaveBeenCalled()
})

it('keeps its buttons on one line without shrinking (FR-007)', () => {
  render(draft())
  expect(host.querySelector('[data-testid="draft-actions"]')!.className).toMatch(/\bshrink-0\b/)
  for (const b of host.querySelectorAll('button')) expect(b.className).toMatch(/\bwhitespace-nowrap\b/)
})
