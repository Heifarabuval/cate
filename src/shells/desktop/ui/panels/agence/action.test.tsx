import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceOpResult, DraftView, QuestionView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../editor/MarkdownPreview', () => ({ MarkdownPreview: () => <div /> }))
import { ActionButton, useAction } from './action'
import DraftReader from './DraftReader'
import QuestionCard from './QuestionCard'

const draft: DraftView = {
  id: 'd1', cible: 'issue:Heifarabuval/cate', kind: 'issue', titre: 'Corriger', statut: 'à valider', texte: 'x', hash: 'h',
}
const question: QuestionView = {
  id: 'q1', question: 'Quel nom ?', options: [{ label: 'Oui', detail: '' }, { label: 'Non', detail: '' }],
  isMerge: false, locks: [], ghUnknown: false, rebase: false,
}

function Card() {
  return <QuestionCard question={question} send={send} action={useAction()} onDone={onDone} />
}

let host: HTMLDivElement
let root: Root
let send: ReturnType<typeof vi.fn<(op: AgenceOp) => Promise<unknown>>>
let reply: (result: AgenceOpResult) => void
const onBack = vi.fn()
const onDone = vi.fn()
const button = (label: string | RegExp) => [...host.querySelectorAll('button')].find((b) => typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))!
const slow = () => send.mockReturnValueOnce(new Promise((resolve) => { reply = resolve }))

beforeEach(() => {
  installMockClientUi()
  send = vi.fn(async (): Promise<AgenceOpResult> => ({ ok: true }))
  onBack.mockClear()
  onDone.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('presses with a short scale and keeps the movement off under reduced motion', () => {
  act(() => root.render(<ActionButton>Go</ActionButton>))
  const { className } = button('Go')
  expect(className).toMatch(/\bactive:scale-\[0\.97\]/)
  expect(className).toMatch(/\bduration-150\b/)
  expect(className).toMatch(/motion-reduce:active:scale-100/)
})

it('goes busy before the answer: spinner, label kept, aria-busy, focus kept, other actions inert', async () => {
  slow()
  act(() => root.render(<DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} />))
  const envoyer = button('Envoyer')
  act(() => envoyer.focus())
  await act(async () => { envoyer.click() })
  expect(envoyer.getAttribute('aria-busy')).toBe('true')
  expect(envoyer.getAttribute('aria-disabled')).toBe('true')
  expect(envoyer.textContent).toBe('Envoyer')
  expect(envoyer.querySelector('.animate-spin')).not.toBeNull()
  expect(envoyer.querySelector('.motion-reduce\\:animate-none')).not.toBeNull()
  expect(document.activeElement).toBe(envoyer)
  expect(button('Modifier').disabled).toBe(true)
  expect(button('Abandonner').disabled).toBe(true)
  await act(async () => { envoyer.click() })
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => reply({ ok: true }))
  expect(onBack).toHaveBeenCalledTimes(1)
})

it('shows a refusal in place and is ready again, nothing busy left', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Texte refusé.' })
  act(() => root.render(<DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} />))
  await act(async () => { button('Envoyer').click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Texte refusé.')
  expect(button('Envoyer').hasAttribute('aria-busy')).toBe(false)
  expect(button('Envoyer').hasAttribute('aria-disabled')).toBe(false)
  expect(onBack).not.toHaveBeenCalled()
})

it('shows a thrown error in place', async () => {
  send.mockRejectedValueOnce(new Error('réseau coupé'))
  act(() => root.render(<DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} />))
  await act(async () => { button('Envoyer').click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('réseau coupé')
})

it('tells the clicked option busy and ignores a second click, then closes on success', async () => {
  slow()
  act(() => root.render(<Card />))
  const non = button(/^Non/)
  await act(async () => { non.click(); non.click() })
  expect(send).toHaveBeenCalledTimes(1)
  expect(non.getAttribute('aria-busy')).toBe('true')
  expect(non.querySelector('.animate-spin')).not.toBeNull()
  expect(button(/^Oui/).disabled).toBe(true)
  expect(onDone).not.toHaveBeenCalled()
  await act(async () => reply({ ok: true }))
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('keeps the same room for its indicator at rest, busy and done, so the button never changes width', () => {
  const slot = () => button('Go').querySelector('[data-testid="action-slot"]')
  act(() => root.render(<ActionButton>Go</ActionButton>))
  const rest = slot()!.className
  expect(slot()!.querySelector('svg')).toBeNull()
  act(() => root.render(<ActionButton busy>Go</ActionButton>))
  expect(slot()!.className).toBe(rest)
  expect(slot()!.querySelector('.animate-spin')).not.toBeNull()
  act(() => root.render(<ActionButton done>Go</ActionButton>))
  expect(slot()!.className).toBe(rest)
  expect(slot()!.querySelector('svg.lucide-check')).not.toBeNull()
})

it('tells a screen reader the result politely, outside the button so its name stays', () => {
  const live = () => host.querySelector('[aria-live="polite"]')!
  act(() => root.render(<ActionButton>Go</ActionButton>))
  expect(live().textContent).toBe('')
  act(() => root.render(<ActionButton busy>Go</ActionButton>))
  expect(live().textContent).toBe('En cours')
  act(() => root.render(<ActionButton done>Go</ActionButton>))
  expect(live().textContent).toBe('Fait')
  expect(button('Go').contains(live())).toBe(false)
  expect(button('Go').textContent).toBe('Go')
})

it('does nothing once its view is gone: no onBack, no timer, for a draft opened since', async () => {
  vi.useFakeTimers()
  try {
    slow()
    act(() => root.render(<DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} />))
    await act(async () => { button('Envoyer').click() })
    act(() => root.render(null))
    await act(async () => reply({ ok: true }))
    expect(onBack).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it.each([
  ['a success closes the draft', { ok: true } as AgenceOpResult],
  ['a refusal shows in place', { ok: false, error: 'conflict', message: 'Texte refusé.' } as AgenceOpResult],
])('under StrictMode (mounted, unmounted, mounted again), %s', async (_name, result) => {
  send.mockResolvedValueOnce(result)
  act(() => root.render(<StrictMode><DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} /></StrictMode>))
  await act(async () => { button('Envoyer').click() })
  if (result.ok) expect(onBack).toHaveBeenCalledTimes(1)
  else expect(host.querySelector('[role="alert"]')!.textContent).toBe('Texte refusé.')
  expect(button('Envoyer').hasAttribute('aria-busy')).toBe(false)
})

it('under StrictMode, a thrown error shows in place', async () => {
  send.mockRejectedValueOnce(new Error('réseau coupé'))
  act(() => root.render(<StrictMode><DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={onBack} /></StrictMode>))
  await act(async () => { button('Envoyer').click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('réseau coupé')
})

it('always renders the room of its indicator, never hidden, so the width holds in a real browser too', () => {
  for (const state of [{}, { busy: true }, { done: true }]) {
    act(() => root.render(<ActionButton {...state}>Go</ActionButton>))
    const slot = button('Go').querySelector('[data-testid="action-slot"]')!
    expect(slot).not.toBeNull()
    expect(slot.className).toMatch(/\binline-flex\b/)
    expect(slot.className).toMatch(/\bw-\[11px\]/)
    expect(slot.className).not.toMatch(/\b(hidden|invisible|sr-only)\b/)
  }
})
