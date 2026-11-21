import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, PratiqueChamp } from '@panels/agence/contract'
import PremieresQuestions from './PremieresQuestions'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// An invented schema (SC-004): the view asks what it receives, in the order received.
const champ = (patch: Partial<PratiqueChamp>): PratiqueChamp => ({
  cle: 'foo.bar', nom: 'Couleur du toit', explique: 'La teinte des tuiles.', groupe: 'essentiel', portee: 'workspace',
  question: 'De quelle couleur, le toit ?', forme: 'valeurs', choix: [{ valeur: 'r', libelle: 'Rouge' }, { valeur: 'b', libelle: 'Bleu' }],
  bornes: null, vide: null, defaut: 'r', valeur: 'r', origine: 'défaut', ...patch,
})
const champs: PratiqueChamp[] = [
  champ({}),
  champ({ cle: 'cache', nom: 'Cave', question: null, choix: [{ valeur: 'o', libelle: 'Oui' }], defaut: 'o', valeur: 'o' }),
  champ({ cle: 'avance.x', nom: 'Grenier', groupe: 'avance', question: 'Un grenier ?' }),
  champ({ cle: 'baz', nom: 'Fenêtres', question: 'Combien de fenêtres par mur ?', forme: 'entier', choix: null, bornes: [1, 5], defaut: 2, valeur: 2 }),
]

let host: HTMLDivElement
let root: Root
const send = vi.fn(async (_op: AgenceOp): Promise<unknown> => ({ ok: true }))
const render = () => act(() => root.render(<PremieresQuestions champs={champs} send={send} />))
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const click = (label: string) => act(async () => { button(label)!.click() })
const heading = () => host.querySelector('h2')!.textContent

beforeEach(() => {
  send.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('asks the essential questions only, one per screen, in the order received', async () => {
  render()
  expect(heading()).toBe('De quelle couleur, le toit ?')
  expect(host.textContent).toContain('1 sur 2')
  await click('Suivant')
  expect(heading()).toBe('Combien de fenêtres par mur ?')
  expect(host.textContent).not.toContain('Un grenier ?')
  expect(button('Suivant')).toBeUndefined()
  expect(button('Terminer')).toBeDefined()
})

it('asks 4 questions at most when 6 are published (SC-006)', async () => {
  const six = Array.from({ length: 6 }, (_, n) => champ({ cle: `q${n}`, question: `Question ${n + 1} ?` }))
  act(() => root.render(<PremieresQuestions champs={six} send={send} />))
  expect(host.textContent).toContain('1 sur 4')
  for (let n = 0; n < 3; n++) await click('Suivant')
  expect(heading()).toBe('Question 4 ?')
  expect(button('Terminer')).toBeDefined()
  await click('Terminer')
  expect(Object.keys((send.mock.calls[0][0] as { reponses: object }).reponses)).toEqual(['q0', 'q1', 'q2', 'q3'])
})

it('preselects the default answer', () => {
  render()
  const checked = host.querySelector<HTMLInputElement>('input[type="radio"]:checked')!
  expect(checked.closest('label')!.textContent).toBe('Rouge')
})

it('goes back with « Précédent », keeping the answer given', async () => {
  render()
  expect(button('Précédent')).toBeUndefined()
  act(() => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1].click())
  await click('Suivant')
  await click('Précédent')
  expect(host.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.closest('label')!.textContent).toBe('Bleu')
})

it('« Terminer » sends every answer at once', async () => {
  render()
  act(() => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1].click())
  await click('Suivant')
  const select = host.querySelector('select')!
  act(() => {
    select.selectedIndex = 3
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click('Terminer')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.questions', reponses: { 'foo.bar': 'b', baz: 4 } })
})

it('« Passer » keeps the defaults', async () => {
  render()
  await click('Passer')
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.questions', passer: true })
})

it('shows the refusal and stays on the questions', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'invalid', message: 'Fenêtres : entre 1 et 5.' })
  render()
  await click('Passer')
  expect(host.textContent).toContain('Fenêtres : entre 1 et 5.')
  expect(heading()).toBe('De quelle couleur, le toit ?')
})

it('shows no key', async () => {
  render()
  for (const cle of ['foo.bar', 'baz', 'cache', 'avance.x']) expect(host.textContent).not.toContain(cle)
  await click('Suivant')
  for (const cle of ['foo.bar', 'baz']) expect(host.textContent).not.toContain(cle)
})
