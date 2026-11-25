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
// What this client shows of a panel (the split between the columns): in memory here.
vi.mock('../../client/document', async (original) => {
  const { useState } = await import('react')
  return { ...await original<object>(), usePanelView: (_workspaceId: string, _panelId: string, _key: string, fallback: unknown) => useState(fallback) }
})
import AgenceView from './AgenceView'

const snapshot = (patch: Partial<AgenceSnapshot> = {}): AgenceSnapshot => ({
  ptyId: null, orchestrator: 'running', regisseur: { state: 'running', error: null, settingsHint: null },
  suivi: {
    repo: 'cate', humain: 'Max', agentsActive: 1, readAt: 't', error: null,
    sections: {
      bloquant: [], fait: [], reste: [],
      aFaire: [{ id: 'n1', title: 'Valider', kind: 'draft', meta: [], evidence: null, link: null, links: [], action: { type: 'draft', draftId: 'd1', inFlight: false } }],
    },
  },
  drafts: { d1: { id: 'd1', cible: 'issue:x/y', kind: 'issue', titre: 'T', statut: 'à valider', texte: 'Texte', hash: 'h' } },
  questions: {},
  garde: 'actif',
  pratiques: null,
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
  expect(host.textContent).toContain('À toi')
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

it.each([
  ['Relancer l\'orchestrateur', { orchestrator: 'exited' }],
  ['Relancer le régisseur', { regisseur: { state: 'stopped', error: 'arrêté', settingsHint: null } }],
] as const)('says « %s » refused as unavailable in words, never the raw code', async (label, patch) => {
  send.mockResolvedValueOnce({ ok: false, error: 'unavailable' } as never)
  render(snapshot(patch as Partial<AgenceSnapshot>))
  await act(async () => { button(label)!.click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Régisseur indisponible.')
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
  expect(host.textContent).toContain('À toi')
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

const separator = () => host.querySelector('[role="separator"]')
const conversationBasis = () => (host.querySelector('[data-testid="conversation-column"]') as HTMLElement).style.flexBasis
/** Drags the separator by `delta` px, from its middle, as a person would. */
const drag = (delta: number) => {
  const handle = separator()!.firstElementChild as HTMLElement
  act(() => { handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 600 })) })
  act(() => { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 600 + delta })) })
  act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
}

it('lets the person resize the columns with the separator, and double click brings the split back', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(1000)
  expect(separator()!.getAttribute('aria-orientation')).toBe('vertical')
  expect(conversationBasis()).toBe('60%')
  drag(100)
  expect(conversationBasis()).toBe('70%')
  drag(-300)
  expect(conversationBasis()).toBe('40%')
  act(() => { (separator()!.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect(conversationBasis()).toBe('60%')
})

it('keeps each column at least 280 px wide while resizing', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(1000)
  drag(900)
  expect(conversationBasis()).toBe('72%')
  drag(-900)
  expect(conversationBasis()).toBe('28%')
})

it('has no separator when the view is tabs', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(500)
  expect(separator()).toBeNull()
})

it('ties each tab to its panel for assistive technology', () => {
  const observer = stubResizeObserver()
  render(snapshot())
  observer.resize(500)
  for (const tab of host.querySelectorAll('[role="tab"]')) {
    const panel = document.getElementById(tab.getAttribute('aria-controls')!)
    expect(panel).not.toBeNull()
    expect(panel!.getAttribute('role')).toBe('tabpanel')
    expect(panel!.getAttribute('aria-labelledby')).toBe(tab.id)
  }
})

it('gives the follow-up short button names in a narrow column', () => {
  const observer = stubResizeObserver()
  const value = snapshot()
  value.suivi!.sections.aFaire = [{ id: 'n2', title: 'Merger la 12 ?', kind: 'human', meta: [], evidence: null, link: null, links: [], action: { type: 'question', questionId: 'q2', rebase: true } }]
  render(value)
  observer.resize(1000)
  expect(button('Demander le rebase')).toBeDefined()
  observer.resize(320)
  expect(button('Demander le rebase')).toBeUndefined()
  expect(button('Rebase')!.getAttribute('aria-label')).toBe('Demander le rebase')
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

it('says a stopped regisseur in words on the line, never the raw code', async () => {
  const value = snapshot()
  value.suivi!.sections.aFaire = [{ id: 'n2', title: 'Merger la 12 ?', kind: 'human', meta: [], evidence: null, link: null, links: [], action: { type: 'question', questionId: 'q2', rebase: true } }]
  send.mockResolvedValueOnce({ ok: false, error: 'unavailable' } as never)
  render(value)
  await act(async () => { button('Demander le rebase')!.click() })
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Régisseur indisponible.')
})

it.each([
  ['Relancer le régisseur', { regisseur: { state: 'stopped', error: 'arrêté', settingsHint: null } }],
  ['Relancer l\'orchestrateur', { orchestrator: 'exited' }],
] as const)('« %s » waits for the answer, ignores a second click, then says it was taken', async (label, patch) => {
  let answer!: (result: { ok: boolean }) => void
  send.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
  render(snapshot(patch as Partial<AgenceSnapshot>))
  await act(async () => { button(label)!.click(); button(label)!.click() })
  expect(send).toHaveBeenCalledTimes(1)
  expect(button(label)!.getAttribute('aria-busy')).toBe('true')
  await act(async () => answer({ ok: true }))
  expect(button(label)!.hasAttribute('aria-busy')).toBe(false)
  expect(button(label)!.querySelector('svg.lucide-check')).not.toBeNull()
})

const banner = () => host.querySelector('[data-testid="regisseur-banner"]')?.textContent ?? ''

it('says the send guard is off, with the command that installs it', () => {
  render(snapshot({ garde: 'inactif' }))
  expect(banner()).toMatch(/garde d'envoi inactif/i)
  expect(banner()).toContain('agence hooks install')
})

it('says the send guard is partial', () => {
  render(snapshot({ garde: 'partiel' }))
  expect(banner()).toMatch(/garde d'envoi partiel/i)
  expect(banner()).toContain('agence hooks install')
})

it('says nothing of the send guard when it is on, or when the regisseur is external or missing', () => {
  render(snapshot({ garde: 'actif' }))
  expect(host.querySelector('[data-testid="regisseur-banner"]')).toBeNull()
  render(snapshot({ garde: 'inactif', regisseur: { state: 'external', error: 'régisseur déjà actif sur 4321', settingsHint: null } }))
  expect(banner()).not.toMatch(/garde d'envoi/i)
  render(snapshot({ garde: 'inactif', suivi: null, regisseur: { state: 'missing', error: 'agence introuvable', settingsHint: null } }))
  expect(banner()).not.toMatch(/garde d'envoi/i)
})

it('says an unknown send guard only after 5 s without a turn of the regisseur', () => {
  vi.useFakeTimers()
  try {
    render(snapshot({ garde: 'inconnu' }))
    expect(banner()).not.toMatch(/garde d'envoi/i)
    act(() => { vi.advanceTimersByTime(4900) })
    expect(banner()).not.toMatch(/garde d'envoi/i)
    act(() => { vi.advanceTimersByTime(200) })
    expect(banner()).toMatch(/garde d'envoi inconnu/i)
    render(snapshot({ garde: 'actif' }))
    expect(banner()).not.toMatch(/garde d'envoi/i)
  } finally {
    vi.useRealTimers()
  }
})

const pratiques = (patch: Partial<NonNullable<AgenceSnapshot['pratiques']>> = {}): NonNullable<AgenceSnapshot['pratiques']> => ({
  preset: 'pr-tdd',
  valeurs: { 'livraison.methode': 'squash', 'livraison.merge': 'clic', preuve: ['pr-mergee', 'ci-verte'], plafond: null },
  sources: { preset: 'dev', 'livraison.methode': 'projet', 'livraison.merge': 'défaut', preuve: 'dev', plafond: 'défaut' },
  erreur: null,
  ...patch,
})

it('shows the policy line with its preset and where it comes from', () => {
  render(snapshot({ pratiques: pratiques() }))
  expect(host.textContent).toContain('Pratiques : pr-tdd (dev)')
  expect(host.textContent).not.toContain('livraison.methode')
})

it('lists every value with its source when the line is opened', () => {
  render(snapshot({ pratiques: pratiques() }))
  act(() => button('Pratiques : pr-tdd (dev)')!.click())
  const rows = [...host.querySelectorAll('[data-testid="pratique"]')].map((row) => row.textContent)
  expect(rows).toEqual([
    'livraison.methode : squash (projet)',
    'livraison.merge : clic (défaut)',
    'preuve : pr-mergee, ci-verte (dev)',
    'plafond : aucune (défaut)',
  ])
})

it('has no « Ouvrir le fichier » any more', () => {
  render(snapshot({ pratiques: pratiques() }))
  act(() => button('Pratiques : pr-tdd (dev)')!.click())
  expect(button('Ouvrir le fichier')).toBeUndefined()
})

it('shows an invalid policy as a banner that names the key, the rest of the panel still there', () => {
  render(snapshot({ pratiques: pratiques({ erreur: 'pratiques.json : clé inconnue « livraison.mthode »' }) }))
  expect(host.textContent).toContain('clé inconnue « livraison.mthode »')
  expect(host.textContent).toContain('À toi')
})

it('shows nothing about the policy when the state has none (old CLI)', () => {
  render(snapshot({ pratiques: null }))
  expect(host.textContent).not.toContain('Pratiques')
  expect(button('Réglages')).toBeUndefined()
})

const champ: NonNullable<NonNullable<AgenceSnapshot['pratiques']>['champs']>[number] = {
  cle: 'foo.bar', nom: 'Couleur du toit', explique: 'La teinte des tuiles.', groupe: 'essentiel', portee: 'workspace',
  forme: 'valeurs', choix: [{ valeur: 'r', libelle: 'Rouge' }, { valeur: 'b', libelle: 'Bleu' }], bornes: null, vide: null,
  defaut: 'r', valeur: 'r', origine: 'défaut',
}
const reglages = (patch: Partial<NonNullable<AgenceSnapshot['pratiques']>> = {}) => pratiques({
  champs: [champ], presets: [{ id: 'calme', nom: 'Tranquille', explique: 'Peu de choses.', actif: true }], projet: true, nbProjet: 0, invariants: [], ...patch,
})

it('opens the settings form from « Réglages », in place of the follow-up, and comes back', () => {
  render(snapshot({ pratiques: reglages() }))
  act(() => button('Réglages')!.click())
  const column = host.querySelector('[data-testid="suivi-column"]')!
  expect(column.querySelector('[data-testid="reglage"][data-nom="Couleur du toit"]')).not.toBeNull()
  expect(column.textContent).not.toContain('À toi')
  act(() => button('Fermer les réglages')!.click())
  expect(column.textContent).toContain('À toi')
})

it('sends what the form asks through the session', async () => {
  render(snapshot({ pratiques: reglages() }))
  act(() => button('Réglages')!.click())
  const select = host.querySelector<HTMLSelectElement>('[data-nom="Couleur du toit"] select')!
  await act(async () => {
    select.selectedIndex = 1
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(send).toHaveBeenCalledWith({ kind: 'pratique.set', cle: 'foo.bar', valeur: 'b' })
})

it('has a line « Accès des agents à Cate » that opens the CLI page of the settings', () => {
  const ui = installMockClientUi()
  render(snapshot({ pratiques: reglages() }))
  act(() => button('Réglages')!.click())
  act(() => button('Accès des agents à Cate')!.click())
  expect(ui.openSettings).toHaveBeenCalledWith('cli')
})

it('says the settings are unavailable when the regisseur does not run', () => {
  render(snapshot({ pratiques: reglages(), regisseur: { state: 'stopped', error: null, settingsHint: null } }))
  act(() => button('Réglages')!.click())
  expect(host.textContent).toContain('Réglages indisponibles')
})

it('keeps the policy line alone, without « Réglages », for a state without fields', () => {
  render(snapshot({ pratiques: pratiques() }))
  expect(host.textContent).toContain('Pratiques : pr-tdd (dev)')
  expect(button('Réglages')).toBeUndefined()
})

const backlog: NonNullable<AgenceSnapshot['backlog']> = {
  fiches: [{ id: 'F2', titre: 'Renommer la section', etat: 'prête', priorite: 'P1', consomme: null }],
  vagues: [['F2']],
  attentes: {},
  enFile: [],
  erreur: null,
}

it('shows the backlog in the follow-up column and launches through the session', async () => {
  render(snapshot({ backlog }))
  const column = host.querySelector('[data-testid="suivi-column"]')!
  expect(column.textContent).toContain('Backlog')
  expect(column.textContent).toContain('À toi')
  act(() => host.querySelector<HTMLInputElement>('input[data-fiche="F2"]')!.click())
  await act(async () => { button('Lancer (1)')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'fiches.lancer', ids: ['F2'] })
})

it('shows no backlog when the state has none (old CLI)', () => {
  render(snapshot({ backlog: null }))
  expect(host.textContent).not.toContain('Backlog')
})

const setupCard = {
  id: 'q3', question: 'Appliquer ces réglages ?\n- Agents en même temps : 4 → 2 (source : réponse de la personne)',
  options: [{ label: 'Appliquer', detail: 'écrit les réglages de ce workspace' }, { label: 'Refuser', detail: "rien n'est écrit" }],
  isMerge: false, locks: [], rebase: false, ghUnknown: false,
} as unknown as AgenceSnapshot['questions'][string]

it('holds the panel for the setup while the project has no settings file: the agent is elsewhere, « Passer » stays', async () => {
  render(snapshot({ pratiques: reglages({ projet: false, champs: [champ] }) }))
  expect(host.querySelector('h2')!.textContent).toBe('Setup du projet')
  expect(host.textContent).toContain('Un agent prépare les réglages de ce workspace avec vous')
  expect(host.querySelector('[data-testid="terminal"]')).toBeNull()
  expect(host.textContent).not.toContain('À toi')
  await act(async () => { button('Passer')!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'setup.passer' })
})

it('shows the setup card with its diff, and answers it through the session', async () => {
  render(snapshot({ pratiques: reglages({ projet: false, champs: [champ] }), questions: { q3: setupCard } }))
  expect(host.textContent).toContain('Agents en même temps : 4 → 2 (source : réponse de la personne)')
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Appliquer (Recommandé)'))!.click() })
  expect(send).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q3', choice: 0 })
})

it('asks nothing once the project has its file', () => {
  render(snapshot({ pratiques: reglages({ projet: true, champs: [champ] }) }))
  expect(button('Passer')).toBeUndefined()
  expect(host.querySelector('[data-testid="terminal"]')).not.toBeNull()
})

it('says to restart a regisseur that stopped during the setup, with one restart button', async () => {
  const held = reglages({ projet: false, champs: [champ] })
  for (const error of ["agence watch s'est arrêté (SIGKILL)", null]) {
    send.mockClear()
    render(snapshot({ pratiques: held, orchestrator: 'starting', regisseur: { state: 'stopped', error, settingsHint: null } }))
    expect(host.textContent).toContain('relancez-le avec « Relancer le régisseur »')
    await act(async () => { button('Passer')!.click() })
    expect(send).not.toHaveBeenCalled()
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Relancer le régisseur')).toHaveLength(1)
    await act(async () => { button('Relancer le régisseur')!.click() })
    expect(send).toHaveBeenCalledWith({ kind: 'orchestrator.restart' })
  }
})

it('keeps « Accès des agents à Cate » usable when the regisseur is stopped and the policy unreadable (FR-016)', () => {
  const ui = installMockClientUi()
  render(snapshot({ pratiques: reglages({ erreur: 'illisible' }), regisseur: { state: 'stopped', error: null, settingsHint: null } }))
  act(() => button('Réglages')!.click())
  const acces = button('Accès des agents à Cate')!
  expect(acces.disabled).toBe(false)
  act(() => acces.click())
  expect(ui.openSettings).toHaveBeenCalledWith('cli')
})
