// The agence panel session (specs/002-panneau-agence): owns the orchestrator's
// PTY, holds a reference on its repository's regisseur, and serves the
// follow-up read from the `agence` CLI's folder. It writes none of the CLI's
// files: every action goes through the regisseur (`click()` of agence.py).
//
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
import type {
  AgenceOp,
  AgenceOpResult,
  AgencePersisted,
  AgenceSnapshot,
  AgenceState,
  DraftKind,
  DraftView,
  GardeState,
  PanelTitles,
  QuestionView,
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
})

export class AgenceSession extends PanelSession<AgenceSnapshot, AgenceOp> {
  private readonly offs: Array<() => void> = []
  private files: StateFiles | null = null
  private regisseur: RegisseurHandle | null = null
  private knownTitles: Record<string, string> = {}
  /** The orchestrator ran once: titles may now be saved (the saved file is
   *  what makes the next start a resume). */
  private launched = false
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
    const resume = saved !== undefined
    this.knownTitles = { ...saved?.knownTitles }
    this.launched = resume
    this.offs.push(this.deps.terminal.onStatusChange((change) => {
      const id = this.state.ptyId
      if (id && Object.prototype.hasOwnProperty.call(change, id)) this.followStatus(change[id])
    }))
    this.files = this.deps.files(path.join(this.root, '.cate', 'tmp', 'agence'), () => this.refresh())
    this.refresh()
    this.startRegisseur()
    await this.spawnOrchestrator(resume)
  }

  protected override readonly ops = this.handlers() as OpHandlers<AgenceOp>

  private handlers(): Partial<OpHandlers<AgenceOp>> {
    return {
      'draft.send': ({ draftId, hash }) => this.draftOp(draftId, 'send', { h: hash }),
      'draft.drop': ({ draftId }) => this.draftOp(draftId, 'drop', {}),
      'draft.edit': ({ draftId }) => this.draftOp(draftId, 'edit', {}),
      'orchestrator.restart': () => this.restart(),
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

  /** One click on the regisseur's form. The session host runs this panel's
   *  ops one at a time, so a second click waits for the first and then gets
   *  the regisseur's own refusal (déjà « envoyer », déjà répondue). */
  private async click(path: string, form: Record<string, string>): Promise<AgenceOpResult> {
    const regisseur = this.regisseur
    if (!regisseur || regisseur.view().state !== 'running') {
      return { ok: false, error: 'unavailable', message: regisseur?.view().error ?? 'regisseur-unavailable' }
    }
    try {
      const reply = await regisseur.post(path, form)
      if (reply.code === 200) return { ok: true }
      const error = reply.code === 403 ? 'unavailable' : reply.code === 400 ? 'invalid' : 'conflict'
      return { ok: false, error, message: reply.message }
    } catch (err) {
      return { ok: false, error: 'unavailable', message: err instanceof Error ? err.message : String(err) }
    }
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
      this.publish({ regisseur, suivi: null, drafts: {}, questions: {}, garde: 'inconnu' })
      return
    }
    const state = read.state
    const now = Date.now()
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
      questions: questions(state, now),
      garde: GARDES.has(state.garde ?? '') ? state.garde as GardeState : 'inconnu',
    })
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
    out[draft.id] = { id: draft.id, cible: draft.cible, kind: kind as DraftKind, titre: draft.titre, statut: draft.statut, texte, hash: draftHash(texte) }
  }
  return out
}

function questions(state: AgenceState, now: number): Record<string, QuestionView> {
  const out: Record<string, QuestionView> = {}
  for (const question of state.questions) {
    if (question.answer !== null && question.answer !== undefined) continue
    out[question.id] = {
      id: question.id,
      question: question.question,
      options: question.options,
      isMerge: typeof question.action === 'string' && question.action.startsWith('merge:'),
      ...mergeState(state, question, now),
    }
  }
  return out
}
