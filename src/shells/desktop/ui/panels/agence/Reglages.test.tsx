import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PRESET_DEFAUT, type AgenceOp, type PratiqueChamp, type PratiquesView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'
import Reglages from './Reglages'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// An invented schema (SC-004): no key, value or label of the real one, so the view
// can only render what it receives.
const champ = (patch: Partial<PratiqueChamp>): PratiqueChamp => ({
  cle: 'foo.bar', nom: 'Couleur du toit', explique: 'La teinte des tuiles.', groupe: 'essentiel', portee: 'workspace', question: null,
  forme: 'valeurs', choix: [{ valeur: 'r', libelle: 'Rouge' }, { valeur: 'b', libelle: 'Bleu' }], bornes: null, vide: null,
  defaut: 'r', valeur: 'r', origine: 'défaut', ...patch,
})
const champs: PratiqueChamp[] = [
  champ({}),
  champ({ cle: 'baz', nom: 'Fenêtres', explique: 'Combien de fenêtres par mur.', forme: 'entier', choix: null, bornes: [1, 5], defaut: 2, valeur: 3, origine: 'projet' }),
  champ({ cle: 'qux.liste', nom: 'Pièces', explique: 'Les pièces à peindre.', groupe: 'avance', forme: 'liste', choix: [{ valeur: 'c', libelle: 'Cuisine' }, { valeur: 's', libelle: 'Salon' }], defaut: null, valeur: ['s'], vide: 'Aucune pièce', origine: 'dev' }),
  champ({ cle: 'zed', nom: 'Nom du chat', explique: 'Comment il s\'appelle.', groupe: 'avance', forme: 'motif', choix: null, defaut: null, valeur: 'Tom', vide: 'Pas de chat', origine: 'ponctuel' }),
]
const pratiques = (patch: Partial<PratiquesView> = {}): PratiquesView => ({
  preset: 'calme', valeurs: {}, sources: {}, erreur: null, champs,
  presets: [
    { id: 'calme', nom: 'Tranquille', explique: 'Peu de choses.', actif: true },
    { id: 'strict', nom: 'Sévère', explique: 'Tout est vérifié.', actif: false },
  ],
  projet: true, nbProjet: 0, invariants: ['Personne ne repeint le toit la nuit.'],
  ...patch,
})

let host: HTMLDivElement
let root: Root
let ui: ReturnType<typeof installMockClientUi>
const send = vi.fn(async (_op: AgenceOp): Promise<unknown> => ({ ok: true }))
const render = (value: PratiquesView, disponible = true) => act(() => root.render(<Reglages pratiques={value} disponible={disponible} send={send} onClose={() => {}} />))
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const field = (nom: string) => host.querySelector<HTMLElement>(`[data-testid="reglage"][data-nom="${nom}"]`)!
const control = <T extends Element>(nom: string, selector: string) => field(nom).querySelector<T>(selector)!
const choose = (select: HTMLSelectElement, index: number) => act(() => {
  select.selectedIndex = index
  select.dispatchEvent(new Event('change', { bubbles: true }))
})

beforeEach(() => {
  ui = installMockClientUi()
  send.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('renders one control per field, after its form: a list, a bounded picker, boxes, a text field', () => {
  render(pratiques())
  expect(control<HTMLSelectElement>('Couleur du toit', 'select').options.length).toBe(2)
  const fenetres = control<HTMLSelectElement>('Fenêtres', 'select')
  expect([...fenetres.options].map((o) => o.textContent)).toEqual(['1', '2', '3', '4', '5'])
  expect(fenetres.selectedOptions[0].textContent).toBe('3')
  expect([...field('Pièces').querySelectorAll('input[type="checkbox"]')].map((box) => (box as HTMLInputElement).checked)).toEqual([false, true])
  expect(control<HTMLInputElement>('Nom du chat', 'input[type="text"]').value).toBe('Tom')
})

it('says each field\'s name, phrase, default and origin in words', () => {
  render(pratiques())
  expect(field('Couleur du toit').textContent).toContain('La teinte des tuiles.')
  expect(field('Couleur du toit').textContent).toContain('Par défaut : Rouge')
  expect(field('Couleur du toit').textContent).toContain('par défaut')
  expect(field('Fenêtres').textContent).toContain('ce workspace')
  expect(field('Fenêtres').textContent).toContain('Par défaut : 2')
  expect(field('Pièces').textContent).toContain('vos réglages')
  expect(field('Pièces').textContent).toContain('Par défaut : Aucune pièce')
  expect(field('Nom du chat').textContent).toContain('ponctuel')
})

it('offers « Revenir au défaut » only away from the default, and sends unset', async () => {
  render(pratiques())
  expect(field('Couleur du toit').textContent).not.toContain('Revenir au défaut')
  const back = [...field('Fenêtres').querySelectorAll('button')].find((b) => b.textContent?.startsWith('Revenir au défaut'))!
  expect(back.textContent).toBe('Revenir au défaut (2)')
  await act(async () => { back.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.unset', cle: 'baz' })
})

it('sends the chosen value as published, never a label', async () => {
  render(pratiques())
  await choose(control<HTMLSelectElement>('Couleur du toit', 'select'), 1)
  expect(send).toHaveBeenLastCalledWith({ kind: 'pratique.set', cle: 'foo.bar', valeur: 'b' })
  await choose(control<HTMLSelectElement>('Fenêtres', 'select'), 0)
  expect(send).toHaveBeenLastCalledWith({ kind: 'pratique.set', cle: 'baz', valeur: 1 })
  await act(async () => { field('Pièces').querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
  expect(send).toHaveBeenLastCalledWith({ kind: 'pratique.set', cle: 'qux.liste', valeur: ['c', 's'] })
  const text = control<HTMLInputElement>('Nom du chat', 'input[type="text"]')
  text.value = 'Félix'
  await act(async () => { field('Nom du chat').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(send).toHaveBeenLastCalledWith({ kind: 'pratique.set', cle: 'zed', valeur: 'Félix' })
})

it('sends one write for a double click on « Enregistrer » while the first is pending', async () => {
  let settle!: (value: unknown) => void
  send.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  render(pratiques())
  control<HTMLInputElement>('Nom du chat', 'input[type="text"]').value = 'Félix'
  const enregistrer = [...field('Nom du chat').querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!
  act(() => {
    enregistrer.click()
    enregistrer.click()
  })
  await act(async () => { settle({ ok: true }) })
  expect(send).toHaveBeenCalledTimes(1)
})

it('folds « Avancé » by default and keeps the essentials open', () => {
  render(pratiques())
  const avance = host.querySelector('details')!
  expect(avance.open).toBe(false)
  expect(avance.querySelector('summary')!.textContent).toBe('Avancé')
  expect(avance.contains(field('Pièces'))).toBe(true)
  expect(avance.contains(field('Couleur du toit'))).toBe(false)
})

it('shows the invariants as text, without a control', () => {
  render(pratiques())
  const invariants = host.querySelector('[data-testid="invariants"]')!
  expect(invariants.textContent).toContain('Personne ne repeint le toit la nuit.')
  expect(invariants.querySelector('input, select, button')).toBeNull()
})

it('shows no key and no JSON in its text (SC-002)', () => {
  render(pratiques())
  const text = host.textContent ?? ''
  for (const cle of ['foo.bar', 'baz', 'qux.liste', 'zed', 'calme', 'strict']) expect(text).not.toContain(cle)
  expect(text).not.toMatch(/[{}[\]"]/)
})

it('puts the regisseur\'s refusal under the field', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'invalid', message: 'Couleur du toit : choisir Rouge ou Bleu.' })
  render(pratiques())
  await choose(control<HTMLSelectElement>('Couleur du toit', 'select'), 1)
  expect(field('Couleur du toit').textContent).toContain('Couleur du toit : choisir Rouge ou Bleu.')
  expect(field('Fenêtres').textContent).not.toContain('choisir')
})

it('says the settings are unavailable while the agence is not running, and writes nothing', () => {
  render(pratiques(), false)
  expect(host.textContent).toContain('Réglages indisponibles : l\'agence ne tourne pas')
  expect(control<HTMLSelectElement>('Couleur du toit', 'select').disabled).toBe(true)
})

it('marks the active preset', () => {
  render(pratiques())
  expect(host.querySelector('[data-testid="preset"][data-actif="true"]')!.textContent).toContain('Tranquille')
  expect(host.querySelector('[data-testid="preset"][data-actif="false"]')!.textContent).toContain('Tout est vérifié.')
})

it('applies a preset without asking when the workspace sets nothing', async () => {
  render(pratiques({ nbProjet: 0 }))
  await act(async () => { button('Appliquer Sévère')!.click() })
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.preset', nom: 'strict' })
})

it('asks before a preset replaces the workspace\'s settings: Annuler sends nothing, Continuer replaces', async () => {
  render(pratiques({ nbProjet: 2 }))
  await act(async () => { button('Appliquer Sévère')!.click() })
  expect(ui.confirm).toHaveBeenCalledWith(expect.stringContaining('2 réglages'))
  expect(send).not.toHaveBeenCalled()
  ui.confirm.mockResolvedValueOnce(true)
  await act(async () => { button('Appliquer Sévère')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.preset', nom: 'strict', remplacer: true })
})

it('makes an invalid policy read-only, with « Repartir des réglages par défaut » behind a confirmation', async () => {
  render(pratiques({ erreur: 'fichier illisible' }))
  expect(host.textContent).toContain('Le fichier de réglages de ce workspace est illisible')
  expect(control<HTMLSelectElement>('Couleur du toit', 'select').disabled).toBe(true)
  expect(button('Appliquer Sévère')).toBeUndefined()
  await act(async () => { button('Repartir des réglages par défaut')!.click() })
  expect(ui.confirm).toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  ui.confirm.mockResolvedValueOnce(true)
  await act(async () => { button('Repartir des réglages par défaut')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.preset', nom: PRESET_DEFAUT, remplacer: true })
})

it('keeps an open list open when a new snapshot arrives: same node, options untouched (#856)', () => {
  render(pratiques())
  const select = control<HTMLSelectElement>('Couleur du toit', 'select')
  const writes = vi.fn()
  const real = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected')!
  Object.defineProperty(HTMLOptionElement.prototype, 'selected', { ...real, set(this: HTMLOptionElement, v: boolean) { writes(); real.set!.call(this, v) } })
  try {
    // The session pushes a new snapshot each second: equal values, new objects.
    render(pratiques({ champs: champs.map((one) => ({ ...one })) }))
  } finally {
    Object.defineProperty(HTMLOptionElement.prototype, 'selected', real)
  }
  expect(control<HTMLSelectElement>('Couleur du toit', 'select')).toBe(select)
  // A native menu closes when React rewrites `option.selected`.
  expect(writes).not.toHaveBeenCalled()
})
