// The agence panel session (specs/002-panneau-agence): owns the orchestrator's
// PTY, holds a reference on its repository's regisseur, and serves the
// follow-up read from the `agence` CLI's folder. It writes none of the CLI's
// files: every action goes through the regisseur (`click()` of agence.py).
//
// The orchestrator waits for the regisseur's first state, and while the state
// says the project has no settings file (`pratiques.projet: false`), for the
// first questions to end (`pratique.questions`, or a file written elsewhere).
// At first start the PTY launches Claude Code on `/orchestrateur`; once the
// panel ran, a start resumes it with the terminal restore launch (the agents
// service types the stamped session's resume command), so a daemon restart
// never starts a second orchestrator. The view attaches to the PTY through
// `process.attach` with the snapshot's `ptyId`, like the terminal view.

import path from 'node:path'
import { RpcError } from '@kernel/rpc/contract'
import type { Json, PanelRecord } from '@workspace/document/contract'
import { TERMINAL_RESTORE_LAUNCH, type LaunchIntent, type TerminalActivity, type TerminalStatus } from '@services/terminal/contract'
import type { TerminalService } from '@services/terminal/runtime'
import { PanelSession, type DisposeReason, type OpHandlers, type SessionKit } from '@panels/framework/runtime'
import { classify, HUMAIN_DEFAUT, mergeState } from './contract/suivi'
import { FICHE_ETATS, PRATIQUE_FORMES, PRESET_DEFAUT } from './contract/types'
import type {
  AgenceOp,
  AgenceOpResult,
  AgencePersisted,
  AgenceSnapshot,
  AgenceState,
  BacklogView,
  DraftKind,
  DraftView,
  FicheView,
  GardeState,
  PanelTitles,
  PratiqueChamp,
  PratiquePreset,
  PratiquesView,
  PratiqueValeur,
  QuestionView,
  StateNeed,
} from './contract/types'
import { draftHash } from './parts/runtime/draftHash'
import type { RegisseurHandle, Regisseurs } from './parts/runtime/regisseur'
import type { StateFiles, StateFilesRead } from './parts/runtime/stateFiles'

export interface AgenceSessionDeps {
  /** Canonical workspace root: the repository when the record names none. */
  root: string
  terminal: Pick<TerminalService, 'spawn' | 'close' | 'statuses' | 'onStatusChange'>
  /** The regisseur registry; it owns each regisseur's `cate` CLI lease. */
  regisseurs: Pick<Regisseurs, 'acquire'>
  /** Reads `<root>/.cate/tmp/agence/` (`createStateFiles`). */
  files(dir: string, onChange: (read: StateFilesRead) => void): StateFiles
}

/** The orchestrator's first launch: Claude Code on the orchestrateur skill. */
export const ORCHESTRATOR_LAUNCH: LaunchIntent = { kind: 'agents.start', params: { agentId: 'claude-code', prompt: '/orchestrateur' } }

const INITIAL_COLS = 80
const INITIAL_ROWS = 24
const OPEN_DRAFT: ReadonlySet<string> = new Set(['à valider', 'envoyer'])
const SAFE_ID = /^[\w-]+$/
const PERM_NEED = /^n\d+$/
const DRAFT_KINDS: ReadonlySet<string> = new Set(['issue', 'pr', 'comment', 'slack', 'mail'])
const GARDES: ReadonlySet<string> = new Set(['actif', 'inactif', 'partiel'])

const initialSnapshot = (): AgenceSnapshot => ({
  ptyId: null,
  orchestrator: 'starting',
  regisseur: { state: 'starting', error: null, settingsHint: null },
  suivi: null,
  drafts: {},
  questions: {},
  garde: 'inconnu',
  pratiques: null,
  backlog: null,
})

export class AgenceSession extends PanelSession<AgenceSnapshot, AgenceOp> {
  private readonly offs: Array<() => void> = []
  private files: StateFiles | null = null
  private regisseur: RegisseurHandle | null = null
  private knownTitles: Record<string, string> = {}
  /** The orchestrator ran once: titles may now be saved (the saved file is
   *  what makes the next start a resume). */
  private launched = false
  /** start() ran and the orchestrator is not launched yet (the first questions may hold it). */
  private pending = false
  /** The first questions got their write: a second answer is refused until the state says so too. */
  private answered = false
  private resume = false
  private activity: TerminalActivity = { type: 'idle' }

  constructor(kit: SessionKit, record: PanelRecord, private readonly deps: AgenceSessionDeps) {
    super(kit, record, initialSnapshot())
  }

  /** The repository the panel follows. */
  get root(): string {
    const root = this.record.fields.root
    return typeof root === 'string' && root ? root : this.deps.root
  }

  override async start(): Promise<void> {
    const saved = this.persisted<AgencePersisted>()
    this.resume = saved !== undefined
    this.knownTitles = { ...saved?.knownTitles }
    this.launched = this.resume
    this.offs.push(this.deps.terminal.onStatusChange((change) => {
      const id = this.state.ptyId
      if (id && Object.prototype.hasOwnProperty.call(change, id)) this.followStatus(change[id])
    }))
    this.files = this.deps.files(path.join(this.root, '.cate', 'tmp', 'agence'), () => this.refresh())
    this.refresh()
    this.startRegisseur()
    this.pending = true
    await this.launchWhenReady()
  }

  protected override readonly ops = this.handlers() as OpHandlers<AgenceOp>

  private handlers(): Partial<OpHandlers<AgenceOp>> {
    return {
      'draft.send': ({ draftId, hash, confirme }) => this.draftOp(draftId, 'send', { h: hash, ...(confirme ? { confirme: '1' } : {}) }),
      'draft.drop': ({ draftId }) => this.draftOp(draftId, 'drop', {}),
      'draft.edit': ({ draftId }) => this.draftOp(draftId, 'edit', {}),
      'orchestrator.restart': () => this.restart(),
      // The settings form: the regisseur validates and writes (same functions, same lock as the CLI).
      'pratique.set': ({ cle, valeur }) => this.pratique(cle, '/pratiques/set', { cle, valeur: JSON.stringify(valeur ?? null) }),
      'pratique.unset': ({ cle }) => this.pratique(cle, '/pratiques/unset', { cle }),
      'pratique.preset': ({ nom, remplacer }) => this.state.pratiques?.presets?.some((preset) => preset.id === nom)
        ? this.click('/pratiques/preset', { nom, ...(remplacer ? { remplacer: '1' } : {}) })
        : Promise.resolve({ ok: false, error: 'invalid' }),
      perm: ({ needId, reponse }) => this.perm(needId, reponse),
      worktree: ({ needId, choix }) => this.offer(needId, 'wt', choix, ['remove', 'keep'], (need) => Boolean(need.worktree)),
      orphan: ({ needId, choix }) => this.offer(needId, 'orphan', choix, ['close', 'keep'], (need) => Boolean(need.orphan)),
      // The regisseur decides which ids are still prêtes, under its lock: a second click gets its 409.
      'fiches.lancer': ({ ids }) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string' && SAFE_ID.test(id))
        ? this.click('/fiches/lancer', { ids: ids.join(',') })
        : Promise.resolve({ ok: false, error: 'invalid' }),
      'pratique.questions': ({ reponses, passer }) => this.questions(reponses, passer === true),
      // A free answer wins over a choice (as in the regisseur's click()): only the text goes.
      answer: ({ questionId, choice, libre, force }) => this.answer(questionId, libre
        ? { libre }
        : { ...(choice !== undefined ? { choice: String(choice) } : {}), ...(force ? { force: '1' } : {}) }),
    }
  }

  /** Closing would end the orchestrator's program. */
  override closeBlocker(): RpcError | null {
    if (!this.state.ptyId || this.state.orchestrator !== 'running' || this.activity.type !== 'running') return null
    const processName = this.activity.processName
    return new RpcError('dirty', `${processName} is running in ${this.record.title}`, { processName })
  }

  protected override release(reason: DisposeReason): void {
    for (const off of this.offs.splice(0)) off()
    this.files?.dispose()
    this.regisseur?.release()
    // On shutdown the terminal service saves the screen for the resume.
    const id = this.state.ptyId
    if (id && reason !== 'shutdown') this.closePty(id)
  }

  // ---- Internals ------------------------------------------------------------

  /** A draft action is the regisseur's `click()`: same effects, same
   *  refusals. The session writes nothing itself. */
  private draftOp(draftId: string, action: 'send' | 'drop' | 'edit', form: Record<string, string>): Promise<AgenceOpResult> {
    const open = SAFE_ID.test(draftId) && this.files?.read().state?.drafts.some((draft) => draft.id === draftId && OPEN_DRAFT.has(draft.statut))
    if (!open) return Promise.resolve({ ok: false, error: 'invalid' })
    return this.click(`/draft/${draftId}/${action}`, form)
  }

  private answer(questionId: string, form: Record<string, string>): Promise<AgenceOpResult> {
    const open = SAFE_ID.test(questionId) && this.files?.read().state?.questions.some((question) => question.id === questionId && question.answer == null)
    if (!open) return Promise.resolve({ ok: false, error: 'invalid' })
    return this.click(`/ask/${questionId}`, form)
  }

  /** Oui or Non for an agent blocked on a readable permission: the regisseur's
   *  `/perm` click, which re-reads the screen and refuses (409) a changed request. */
  private perm(needId: string, reponse: string): Promise<AgenceOpResult> {
    const ask = PERM_NEED.test(needId) && (reponse === 'oui' || reponse === 'non') && this.files?.read().state?.needs.some((need) => need.id === needId && need.status === 'open' && need.perm && need.perm.choix.length > 0)
    if (!ask) return Promise.resolve({ ok: false, error: 'invalid' })
    return this.click(`/perm/${needId}/${reponse}`, {})
  }

  /** Supprimer or Garder a merged worktree, Fermer or Garder a panel without an agent: the regisseur's
   *  `/wt` and `/orphan` clicks, which re-check before they act and refuse (409) what changed. */
  private offer(needId: string, route: 'wt' | 'orphan', choix: string, choices: readonly string[], offered: (need: StateNeed) => boolean): Promise<AgenceOpResult> {
    const open = PERM_NEED.test(needId) && choices.includes(choix) && this.files?.read().state?.needs.some((need) => need.id === needId && need.status === 'open' && offered(need))
    if (!open) return Promise.resolve({ ok: false, error: 'invalid' })
    return this.click(`/${route}/${needId}/${choix}`, {})
  }

  /** One click on the regisseur's form. The session host runs this panel's
   *  ops one at a time, so a second click waits for the first and then gets
   *  the regisseur's own refusal (déjà « envoyer », déjà répondue). */
  private async click(path: string, form: Record<string, string | string[]>): Promise<AgenceOpResult> {
    const regisseur = this.regisseur
    if (!regisseur || regisseur.view().state !== 'running') {
      return { ok: false, error: 'unavailable', message: regisseur?.view().error ?? 'regisseur-unavailable' }
    }
    try {
      const reply = await regisseur.post(path, form)
      // The CLI's success is its `click()` code 303 (the page's redirect), carried in the JSON body.
      if (reply.code === 200 || reply.code === 303) return { ok: true }
      const error = reply.code === 403 ? 'unavailable' : reply.code === 400 ? 'invalid' : 'conflict'
      return { ok: false, error, message: reply.message }
    } catch (err) {
      return { ok: false, error: 'unavailable', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** A setting of a key the regisseur published; any other is refused here. */
  private pratique(cle: string, path: string, form: Record<string, string>): Promise<AgenceOpResult> {
    const known = this.state.pratiques?.champs?.some((champ) => champ.cle === cle)
    return known ? this.click(path, form) : Promise.resolve({ ok: false, error: 'invalid' })
  }

  /** The first questions hold the orchestrator: agence runs and its state says the
   *  project has no settings file, or no state was read yet from a regisseur that runs. */
  private held(): boolean {
    const regisseur = this.regisseur?.view().state
    if (regisseur === undefined || regisseur === 'missing') return false
    if (!this.files?.read().state) return regisseur === 'starting' || regisseur === 'running'
    return this.state.pratiques?.projet === false
  }

  private async launchWhenReady(): Promise<void> {
    if (!this.pending || this.disposed || this.held()) return
    this.pending = false
    await this.spawnOrchestrator(this.resume)
  }

  /** The end of the first questions: one write (every answer, or the default preset), then the launch. */
  private async questions(reponses: Record<string, PratiqueValeur> | undefined, passer: boolean): Promise<AgenceOpResult> {
    if (this.answered || this.state.pratiques?.projet !== false) return { ok: false, error: 'conflict', message: 'Les premières questions ont déjà une réponse.' }
    let result: AgenceOpResult
    if (passer) {
      result = await this.click('/pratiques/preset', { nom: PRESET_DEFAUT })
    } else {
      const entries = Object.entries(reponses ?? {})
      const known = new Set(this.state.pratiques.champs?.map((champ) => champ.cle))
      if (entries.length === 0 || !entries.every(([cle]) => known.has(cle))) return { ok: false, error: 'invalid' }
      result = await this.click('/pratiques/set', { cle: entries.map(([cle]) => cle), valeur: entries.map(([, valeur]) => JSON.stringify(valeur ?? null)) })
    }
    if (!result.ok) return result
    this.answered = true
    if (!this.pending) return result
    this.pending = false
    await this.spawnOrchestrator(this.resume)
    return result
  }

  /** Starts what died: the orchestrator (resumed in a new PTY) and the
   *  regisseur. Busy when both run. Nothing restarts by itself. */
  private async restart(): Promise<AgenceOpResult> {
    const orchestratorDown = this.state.orchestrator === 'exited' || this.state.orchestrator === 'failed'
    const regisseurRestarted = this.regisseur?.restart() ?? false
    if (!orchestratorDown) return regisseurRestarted ? { ok: true } : { ok: false, error: 'busy' }
    const previous = this.state.ptyId
    // The new PTY reuses the panel's terminal logs: the old one goes first.
    if (previous) this.closePty(previous)
    this.publish({ ptyId: null, orchestrator: 'starting' })
    await this.spawnOrchestrator(this.launched)
    return this.state.orchestrator === 'running' ? { ok: true } : { ok: false, error: 'unavailable', message: 'orchestrator-failed' }
  }

  private startRegisseur(): void {
    const regisseur = this.deps.regisseurs.acquire({
      root: this.root,
      panelId: this.panelId,
      port: () => this.files?.read().state?.port ?? null,
    })
    this.regisseur = regisseur
    this.offs.push(regisseur.onChange(() => this.refresh()))
    this.refresh()
  }

  private async spawnOrchestrator(resume: boolean): Promise<void> {
    let result: { id: string }
    try {
      result = await this.deps.terminal.spawn({
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        cwd: this.root,
        panelId: this.panelId,
        ...(resume ? { launch: TERMINAL_RESTORE_LAUNCH, restore: true } : { launch: ORCHESTRATOR_LAUNCH }),
      })
    } catch (err) {
      this.kit.log.warn('starting the orchestrator of %s failed: %O', this.panelId, err)
      this.publish({ ptyId: null, orchestrator: 'failed' })
      return
    }
    if (this.disposed) return this.closePty(result.id)
    this.publish({ ptyId: result.id, orchestrator: 'running' })
    this.launched = true
    this.save()
    this.followStatus(this.deps.terminal.statuses()[result.id] ?? null)
  }

  private followStatus(status: TerminalStatus | null | undefined): void {
    if (!status) return
    this.activity = status.alive ? status.activity : { type: 'idle' }
    if (!status.alive) this.publish({ orchestrator: 'exited' })
  }

  private closePty(id: string): void {
    try { this.deps.terminal.close(id) } catch (err) { this.kit.log.warn('closing the orchestrator %s failed: %O', id, err) }
  }

  /** Republishes the regisseur, the follow-up, drafts and questions. */
  private refresh(): void {
    if (this.disposed || !this.files) return
    const regisseur = this.regisseur?.view() ?? this.state.regisseur
    const read = this.files.read()
    // No agence CLI: nothing to act through, so nothing is shown as actionable.
    if (regisseur.state === 'missing' || !read.state) {
      this.publish({ regisseur, suivi: null, drafts: {}, questions: {}, garde: 'inconnu', pratiques: null, backlog: null })
      if (this.pending) void this.launchWhenReady()
      return
    }
    const state = read.state
    const now = Date.now()
    const pratiques = pratiquesView(state.pratiques)
    if (pratiques?.projet !== false) this.answered = false
    this.publish({
      regisseur,
      suivi: {
        repo: state.repo,
        humain: state.humain || HUMAIN_DEFAUT,
        agentsActive: state.agentsActive,
        readAt: read.readAt ?? '',
        error: read.error,
        sections: classify(state, this.titles(state), now),
      },
      drafts: drafts(state, read.drafts),
      questions: questions(state, now, pratiques),
      garde: GARDES.has(state.garde ?? '') ? state.garde as GardeState : 'inconnu',
      pratiques,
      backlog: backlogView(state.backlog),
    })
    if (this.pending) void this.launchWhenReady()
  }

  /** Titles of the panels the needs link: the document's for live panels,
   *  else the last one known (saved), else the CLI's. */
  private titles(state: AgenceState): PanelTitles {
    const panels = this.kit.document.get().panels
    const out: PanelTitles = {}
    for (const panelId of new Set(state.needs.flatMap((need) => need.panels))) {
      const live = panels[panelId]
      const title = live?.title || this.knownTitles[panelId] || state.titles[panelId]
      if (title) out[panelId] = { title, closed: !live }
    }
    const known = { ...this.knownTitles, ...Object.fromEntries(Object.entries(out).map(([id, { title }]) => [id, title])) }
    if (JSON.stringify(known) !== JSON.stringify(this.knownTitles)) {
      this.knownTitles = known
      this.save()
    }
    return out
  }

  private save(): void {
    if (!this.launched) return
    const value: AgencePersisted = { knownTitles: this.knownTitles }
    this.persist(value as unknown as Json)
  }
}

function drafts(state: AgenceState, texts: Record<string, string>): Record<string, DraftView> {
  const out: Record<string, DraftView> = {}
  for (const draft of state.drafts) {
    const texte = texts[draft.id]
    if (texte === undefined) continue
    const kind = draft.cible.split(':', 1)[0]
    if (!DRAFT_KINDS.has(kind)) continue
    out[draft.id] = { id: draft.id, cible: draft.cible, kind: kind as DraftKind, titre: draft.titre, statut: draft.statut, texte, hash: draftHash(texte), ...(draft.incertain ? { incertain: true as const } : {}) }
  }
  return out
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isString = (x: unknown): x is string => typeof x === 'string'

/** The policy as the CLI wrote it, or null when it is absent or not shaped like one. The form
 *  view rides along when the CLI publishes it (contract: `contract/fixtures/vue-reglages.json`);
 *  a field or preset of the wrong shape is dropped, the rest kept. */
function pratiquesView(raw: unknown): PratiquesView | null {
  if (!isRecord(raw) || typeof raw.preset !== 'string' || !isRecord(raw.valeurs) || !isRecord(raw.sources)) return null
  const view: PratiquesView = {
    preset: raw.preset,
    valeurs: raw.valeurs as Record<string, PratiqueValeur>,
    sources: raw.sources as Record<string, string>,
    erreur: typeof raw.erreur === 'string' && raw.erreur ? raw.erreur : null,
  }
  if (Array.isArray(raw.champs)) view.champs = raw.champs.filter(isChamp)
  if (Array.isArray(raw.presets)) view.presets = raw.presets.filter((preset): preset is PratiquePreset => isRecord(preset) && isString(preset.id) && isString(preset.nom) && isString(preset.explique) && typeof preset.actif === 'boolean')
  if (typeof raw.projet === 'boolean') view.projet = raw.projet
  if (typeof raw.nbProjet === 'number') view.nbProjet = raw.nbProjet
  if (Array.isArray(raw.invariants)) view.invariants = raw.invariants.filter(isString)
  return view
}

function isChamp(x: unknown): x is PratiqueChamp {
  return isRecord(x) && isString(x.cle) && isString(x.nom) && isString(x.explique) && isString(x.origine)
    && (x.groupe === 'essentiel' || x.groupe === 'avance') && (x.portee === 'workspace' || x.portee === 'dev')
    && (PRATIQUE_FORMES as readonly unknown[]).includes(x.forme)
    && (x.choix === null || (Array.isArray(x.choix) && x.choix.every((choix) => isRecord(choix) && isString(choix.libelle))))
    && (x.bornes === null || (Array.isArray(x.bornes) && x.bornes.length === 2 && x.bornes.every((n) => typeof n === 'number')))
}
const numberOrNull = (x: unknown): number | null => typeof x === 'number' && Number.isFinite(x) ? x : null

/** The backlog the regisseur published (contract: `contract/fixtures/vue-backlog.json`), or
 *  null when absent or not shaped like one. A fiche of the wrong shape is dropped; an
 *  unreadable consumption stays null, never 0. */
function backlogView(raw: unknown): BacklogView | null {
  if (!isRecord(raw) || !Array.isArray(raw.fiches)) return null
  const fiches: FicheView[] = []
  for (const fiche of raw.fiches) {
    if (!isRecord(fiche) || typeof fiche.id !== 'string' || typeof fiche.titre !== 'string' || !(FICHE_ETATS as readonly unknown[]).includes(fiche.etat)) continue
    fiches.push({
      id: fiche.id,
      titre: fiche.titre,
      etat: fiche.etat as FicheView['etat'],
      priorite: typeof fiche.priorite === 'string' ? fiche.priorite : null,
      consomme: numberOrNull(fiche.consomme),
    })
  }
  const vagues = Array.isArray(raw.vagues) ? raw.vagues.filter((vague): vague is string[] => Array.isArray(vague) && vague.every((id) => typeof id === 'string')) : []
  const attentes = isRecord(raw.attentes) ? Object.fromEntries(Object.entries(raw.attentes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
  const enFile = Array.isArray(raw.enFile) ? raw.enFile.filter((id): id is string => typeof id === 'string') : []
  return { fiches, vagues, attentes, enFile, erreur: typeof raw.erreur === 'string' && raw.erreur ? raw.erreur : null }
}

function questions(state: AgenceState, now: number, pratiques: PratiquesView | null): Record<string, QuestionView> {
  const methode = pratiques?.valeurs['livraison.methode']
  const out: Record<string, QuestionView> = {}
  for (const question of state.questions) {
    if (question.answer !== null && question.answer !== undefined) continue
    out[question.id] = {
      id: question.id,
      question: question.question,
      // A regisseur card marks an option taken by a null click: it shows greyed, never clickable.
      options: question.options.map((option, index) => question.clics?.[index] === null ? { ...option, fait: true as const } : option),
      isMerge: typeof question.action === 'string' && question.action.startsWith('merge:'),
      ...mergeState(state, question, now),
    }
    if (out[question.id].isMerge && typeof methode === 'string') out[question.id].methode = methode
  }
  return out
}
