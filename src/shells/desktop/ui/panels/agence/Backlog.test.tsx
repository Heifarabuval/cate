import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgenceOp, AgenceOpResult, BacklogView } from '@panels/agence/contract'
import { installMockClientUi } from '../../../../../test/clientUi'
import Backlog, { LancerPretes } from './Backlog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The backlog the regisseur publishes (contract of lot 4).
const published = JSON.parse(readFileSync(path.join(__dirname, '../../../../../panels/agence/contract/fixtures/vue-backlog.json'), 'utf8')).backlog as BacklogView

let host: HTMLDivElement
let root: Root
let send: ReturnType<typeof vi.fn<(op: AgenceOp) => Promise<unknown>>>
const render = (backlog: BacklogView = published) => act(() => root.render(<><Backlog backlog={backlog} /><LancerPretes backlog={backlog} send={send} /></>))
const lancer = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Lancer'))!
const box = (id: string) => host.querySelector<HTMLInputElement>(`input[type="checkbox"][data-fiche="${id}"]`)
const row = (id: string) => host.querySelector<HTMLElement>(`[data-testid="fiche"][data-fiche="${id}"]`)!
const group = (etat: string) => host.querySelector<HTMLElement>(`[data-testid="groupe"][data-etat="${etat}"]`)
const check = (id: string) => act(() => box(id)!.click())

beforeEach(() => {
  installMockClientUi()
  send = vi.fn(async (): Promise<AgenceOpResult> => ({ ok: true }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('groups the fiches by state, discussion folded', () => {
  render()
  for (const etat of ['prête', 'lancée', 'discussion', 'faite', 'abandonnée']) expect(group(etat)).not.toBeNull()
  expect(group('prête')!.textContent).toContain('Prêtes (3)')
  expect(group('discussion')!.tagName).toBe('DETAILS')
  expect((group('discussion') as HTMLDetailsElement).open).toBe(false)
  expect(group('discussion')!.textContent).toContain('Idée : lentilles au hasard')
})

it('shows state only: the backlog alone has no checkbox and no « Lancer » (D5)', () => {
  act(() => root.render(<Backlog backlog={published} />))
  expect(host.querySelector('input[type="checkbox"]')).toBeNull()
  expect(host.querySelector('button')).toBeNull()
  expect(host.textContent).not.toContain('À toi')
})

it('puts a checkbox on the prêtes only', () => {
  render()
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((b) => b.dataset.fiche)).toEqual(['F2', 'F4', 'F5'])
})

it('keeps « Lancer (0) » disabled until a fiche is checked, then sends the checked ids', async () => {
  render()
  expect(lancer().textContent).toBe('Lancer (0)')
  expect(lancer().disabled).toBe(true)
  check('F2')
  check('F5')
  expect(lancer().textContent).toBe('Lancer (2)')
  expect(lancer().disabled).toBe(false)
  await act(async () => { lancer().click() })
  expect(send).toHaveBeenCalledWith({ kind: 'fiches.lancer', ids: ['F2', 'F5'] })
  expect(lancer().textContent).toBe('Lancer (0)')
})

it('leaves the prêtes already in the queue out of the checkboxes and of « Lancer (n) »', () => {
  render({ ...published, enFile: ['F2'] })
  expect(box('F2')).toBeNull()
  check('F4')
  check('F5')
  expect(lancer().textContent).toBe('Lancer (2)')
})

it('sends once on a double click: the button waits while the launch is in flight', async () => {
  let resolve!: (result: AgenceOpResult) => void
  send.mockImplementation(() => new Promise((r) => { resolve = r }))
  render()
  check('F2')
  act(() => { lancer().click(); lancer().click() })
  expect(lancer().getAttribute('aria-busy')).toBe('true')
  act(() => lancer().click())
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ ok: true }))
  expect(lancer().getAttribute('aria-busy')).toBeNull()
})

it("shows the regisseur's refusal in place", async () => {
  send.mockResolvedValue({ ok: false, error: 'conflict', message: "F2 n'est plus prête : rien lancé." })
  render()
  check('F2')
  await act(async () => { lancer().click() })
  expect(host.textContent).toContain("F2 n'est plus prête : rien lancé.")
})

it('says why a prête waits', () => {
  render()
  expect(row('F2').textContent).toContain('attend : chevauche F1')
  expect(row('F4').textContent).toContain('attend : plafond (4)')
  expect(row('F5').textContent).not.toContain('attend')
})

it('shows the file error banner and launches nothing', () => {
  render({ fiches: published.fiches, vagues: [], attentes: {}, enFile: [], erreur: 'backlog.json : F2 : etat invalide' })
  expect(host.querySelector('[role="alert"], [data-tone="error"]')?.textContent ?? host.textContent).toContain('Backlog invalide : backlog.json : F2 : etat invalide')
  check('F2')
  expect(lancer().disabled).toBe(true)
})

it('shows consumed against budget on each lancée, « inconnu » when unknown, never 0', () => {
  render()
  expect(row('F1').textContent).toContain('11 000 / 10 000 jetons')
  expect(row('F3').textContent).toContain('inconnu / 8 000 jetons')
  expect(row('F3').textContent).not.toContain('0 /')
  expect(row('F2').textContent).not.toContain('jetons')
})

it('totals the lancées: unknown when one consumption or one budget is unknown', () => {
  render()
  expect(host.querySelector('[data-testid="total"]')!.textContent).toBe('Total des fiches lancées : inconnu / 18 000 jetons')
  render({ ...published, fiches: published.fiches.map((f) => f.id === 'F3' ? { ...f, consomme: 4000 } : f) })
  expect(host.querySelector('[data-testid="total"]')!.textContent).toBe('Total des fiches lancées : 15 000 / 18 000 jetons')
  render({ ...published, fiches: published.fiches.map((f) => f.id === 'F3' ? { ...f, consomme: 4000, budgetJetons: null } : f) })
  expect(host.querySelector('[data-testid="total"]')!.textContent).toBe('Total des fiches lancées : 15 000 / inconnu jetons')
})

it('has no total without a lancée', () => {
  render({ ...published, fiches: published.fiches.filter((f) => f.etat !== 'lancée') })
  expect(host.querySelector('[data-testid="total"]')).toBeNull()
})

it('keeps the title readable next to a long wait reason: the reason takes its own line and never squeezes it (issue 195)', () => {
  const chemin = 'src/shells/desktop/ui/panels/agence/une/branche/tres/profonde/Composant.tsx'
  render({ ...published, attentes: { F2: `chevauche F1 sur ${chemin}` } })
  const attend = row('F2').querySelector<HTMLElement>('[data-testid="attend"]')!
  expect(attend.textContent).toBe(`attend : chevauche F1 sur ${chemin}`)
  expect(attend.className).not.toContain('shrink-0')
  expect(attend.className).toContain('basis-full')
  expect(attend.className).toContain('break-all')
  expect(row('F2').className).toContain('flex-wrap')
})

it('shows a prête already in the queue under « En file », no longer under « Prêtes » (issue 197)', () => {
  render({ ...published, enFile: ['F2'], attentes: { F2: 'chevauche F1 sur src/a.ts' } })
  expect(group('enFile')!.textContent).toContain('En file (1)')
  expect(group('enFile')!.contains(row('F2'))).toBe(true)
  expect(group('prête')!.textContent).toContain('Prêtes (2)')
  expect(group('prête')!.contains(row('F2'))).toBe(false)
  expect(row('F2').textContent).toContain('attend : chevauche F1 sur src/a.ts')
})
