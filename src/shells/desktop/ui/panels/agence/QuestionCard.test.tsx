import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceOpResult, QuestionView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'
import QuestionCard from './QuestionCard'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const question = (patch: Partial<QuestionView> = {}): QuestionView => ({
  id: 'q1', question: 'Quel nom pour le panneau ?',
  options: [{ label: 'Agence', detail: 'le nom du métier' }, { label: 'Suivi', detail: 'le nom actuel' }],
  isMerge: false, locks: [], ghUnknown: false, rebase: false,
  ...patch,
})
const mergeQuestion = (patch: Partial<QuestionView> = {}) => question({
  id: 'q2', question: 'Merger la PR 12 ?', isMerge: true,
  options: [{ label: 'Merger (rebase)', detail: 'gh pr merge --rebase' }, { label: 'Demander des changements', detail: "l'agent reprend la PR" }],
  ...patch,
})

let host: HTMLDivElement
let root: Root
let ui: ReturnType<typeof installMockClientUi>
let send: ReturnType<typeof vi.fn<(op: AgenceOp) => Promise<unknown>>>
const onDone = vi.fn()
const render = (value: QuestionView) => act(() => root.render(<QuestionCard question={value} send={send} onDone={onDone} />))
const button = (label: string | RegExp) => [...host.querySelectorAll('button')].find((b) => typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))
const click = async (label: string | RegExp) => { await act(async () => { button(label)!.click() }) }

beforeEach(() => {
  ui = installMockClientUi()
  send = vi.fn(async (): Promise<AgenceOpResult> => ({ ok: true }))
  onDone.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('shows the question, its options with the recommended one first, and a free answer', () => {
  render(question())
  expect(host.textContent).toContain('Quel nom pour le panneau ?')
  const options = [...host.querySelectorAll('[data-testid="option"]')]
  expect(options.map((option) => option.querySelector('b')!.textContent)).toEqual(['Agence (Recommandé)', 'Suivi'])
  expect(options[0].textContent).toContain('le nom du métier')
  expect(host.querySelector('textarea')).not.toBeNull()
})

it('sends the index of the option clicked, and closes when it is taken', async () => {
  render(question())
  await click(/^Suivi/)
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q1', choice: 1 })
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('sends the free text, only when there is some', async () => {
  render(question())
  expect(button('Répondre')!.disabled).toBe(true)
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Plutôt Orchestre')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Répondre')
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q1', libre: 'Plutôt Orchestre' })
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('sends choice 0 from the Merger button of a merge question', async () => {
  render(mergeQuestion())
  await click(/^Merger \(rebase\)/)
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q2', choice: 0 })
  expect(host.textContent).not.toContain('Merger quand même')
  expect(host.textContent).not.toContain('Demander le rebase')
})

it('greys Merger with its reasons, offers Merger quand même, and the rebase on a conflict', async () => {
  render(mergeQuestion({ locks: ['n11 : Revue de la PR 12', 'conflit avec la base'], rebase: true }))
  expect(button(/^Merger \(rebase\)/)!.disabled).toBe(true)
  expect(host.textContent).toContain('Merger grisé')
  expect(host.textContent).toContain('n11 : Revue de la PR 12')
  expect(host.textContent).toContain('conflit avec la base')
  ui.confirm.mockResolvedValueOnce(true)
  await click('Merger quand même')
  expect(send).toHaveBeenLastCalledWith({ kind: 'answer', questionId: 'q2', choice: 0, force: true })
  await click('Demander le rebase')
  expect(send).toHaveBeenLastCalledWith({ kind: 'answer', questionId: 'q2', choice: 'rebase' })
  // Only the merge over locks asks.
  expect(ui.confirm).toHaveBeenCalledTimes(1)
})

it('asks before merging over the locks, naming each, and sends nothing when declined', async () => {
  render(mergeQuestion({ locks: ['n11 : Revue de la PR 12', 'conflit avec la base'], rebase: true }))
  ui.confirm.mockResolvedValueOnce(false)
  await click('Merger quand même')
  expect(ui.confirm).toHaveBeenCalledTimes(1)
  const message = String((ui.confirm.mock.calls[0] as unknown[])[0])
  expect(message).toContain('n11 : Revue de la PR 12')
  expect(message).toContain('conflit avec la base')
  expect(send).not.toHaveBeenCalled()
  expect(button('Merger quand même')!.disabled).toBe(false)
})

it('merges without any dialog when nothing locks it', async () => {
  render(mergeQuestion())
  await click(/^Merger \(rebase\)/)
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q2', choice: 0 })
})

it('offers no rebase when the lock is not a conflict', () => {
  render(mergeQuestion({ locks: ['checks ou revue requis'], rebase: false }))
  expect(button('Merger quand même')).toBeDefined()
  expect(button('Demander le rebase')).toBeUndefined()
})

it('says when the GitHub state of the PR is unknown', () => {
  render(mergeQuestion({ ghUnknown: true }))
  expect(host.textContent).toContain('état GitHub inconnu')
  expect(button(/^Merger \(rebase\)/)!.disabled).toBe(false)
})

it('shows a refusal in the card and stays open, ready to try again', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Question déjà répondue.' })
  render(question())
  await click(/^Suivi/)
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Question déjà répondue.')
  expect(onDone).not.toHaveBeenCalled()
  expect(button(/^Suivi/)!.disabled).toBe(false)
})

it('sends once on a double click: the buttons wait for the answer', async () => {
  let answer!: (result: AgenceOpResult) => void
  send.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
  render(question())
  await act(async () => { button(/^Suivi/)!.click(); button(/^Suivi/)!.click() })
  expect(send).toHaveBeenCalledTimes(1)
  expect(button(/^Agence/)!.disabled).toBe(true)
  await act(async () => answer({ ok: true }))
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('keeps its buttons on one line without shrinking (FR-007)', () => {
  render(mergeQuestion({ locks: ['conflit avec la base'], rebase: true }))
  for (const b of host.querySelectorAll('button')) expect(b.className).toMatch(/\bwhitespace-nowrap\b|\btext-left\b/)
  expect(host.querySelector('[data-testid="question-actions"]')!.className).toMatch(/\bshrink-0\b/)
})
