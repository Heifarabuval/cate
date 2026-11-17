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
import { classify } from './contract/suivi'
import type {
  AgenceOp,
  AgenceOpResult,
  AgencePersisted,
  AgenceSnapshot,
  AgenceState,
  DraftKind,
  DraftView,
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
  regisseurs: Pick<Regisseurs, 'acquire'>
  /** The `cate` CLI env the regisseur runs with; revoked when it stops. */
  cliEnv(panelId: string): Promise<{ env: Record<string, string>; revoke(): void }>
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

const initialSnapshot = (): AgenceSnapshot => ({
  ptyId: null,
  orchestrator: 'starting',
  regisseur: { state: 'starting', error: null, settingsHint: null },
  suivi: null,
  drafts: {},
  questions: {},
})

export class AgenceSession extends PanelSession<AgenceSnapshot, AgenceOp> {
  private readonly offs: Array<() => void> = []
  private files: StateFiles | null = null
  private regisseur: RegisseurHandle | null = null
  private lease: { revoke(): void } | null = null
  private knownTitles: Record<string, string> = {}
  /** The orchestrator ran once: titles may now be saved (the saved file is
   *  what makes the next start a resume). */
  private launched = false
  private activity: TerminalActivity = { type: 'idle' }
  /** Drafts with an op under way: a second click is refused `busy`. */
  private readonly inFlight = new Set<string>()

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
    await this.startRegisseur()
    if (this.disposed) return
    await this.spawnOrchestrator(resume)
  }

  // `answer` and `orchestrator.restart` come with their stories.
  protected override readonly ops = this.draftOps() as OpHandlers<AgenceOp>

  private draftOps(): Partial<OpHandlers<AgenceOp>> {
    return {
      'draft.send': ({ draftId, hash }) => this.draftOp(draftId, 'send', { h: hash }),
      'draft.drop': ({ draftId }) => this.draftOp(draftId, 'drop', {}),
      'draft.edit': ({ draftId }) => this.draftOp(draftId, 'edit', {}),
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
    this.lease?.revoke()
    // On shutdown the terminal service saves the screen for the resume.
    const id = this.state.ptyId
    if (id && reason !== 'shutdown') this.closePty(id)
  }

  // ---- Internals ------------------------------------------------------------

  /** A draft action is the regisseur's `click()`: same effects, same
   *  refusals. The session writes nothing itself. */
  private async draftOp(draftId: string, action: 'send' | 'drop' | 'edit', form: Record<string, string>): Promise<AgenceOpResult> {
    const open = SAFE_ID.test(draftId) && this.files?.read().state?.drafts.some((draft) => draft.id === draftId && OPEN_DRAFT.has(draft.statut))
    if (!open) return { ok: false, error: 'invalid' }
    if (this.inFlight.has(draftId)) return { ok: false, error: 'busy' }
    const regisseur = this.regisseur
    if (!regisseur || regisseur.view().state !== 'running') {
      return { ok: false, error: 'unavailable', message: regisseur?.view().error ?? 'regisseur-unavailable' }
    }
    this.inFlight.add(draftId)
    try {
      const reply = await regisseur.post(`/draft/${draftId}/${action}`, form)
      if (reply.code === 200) return { ok: true }
      return { ok: false, error: reply.code === 403 ? 'unavailable' : 'conflict', message: reply.message }
    } catch (err) {
      return { ok: false, error: 'unavailable', message: err instanceof Error ? err.message : String(err) }
    } finally {
      this.inFlight.delete(draftId)
    }
  }

  private async startRegisseur(): Promise<void> {
    let lease: { env: Record<string, string>; revoke(): void }
    try {
      lease = await this.deps.cliEnv(this.panelId)
    } catch (err) {
      this.publish({ regisseur: { state: 'stopped', error: err instanceof Error ? err.message : String(err), settingsHint: null } })
      return
    }
    if (this.disposed) return lease.revoke()
    this.lease = lease
    const regisseur = this.deps.regisseurs.acquire({
      root: this.root,
      port: () => this.files?.read().state?.port ?? null,
      env: lease.env,
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
      this.publish({ regisseur, suivi: null, drafts: {}, questions: {} })
      return
    }
    const state = read.state
    this.publish({
      regisseur,
      suivi: {
        repo: state.repo,
        agentsActive: state.agentsActive,
        readAt: read.readAt ?? '',
        error: read.error,
        sections: classify(state, this.titles(state)),
      },
      drafts: drafts(state, read.drafts),
      questions: questions(state),
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

function questions(state: AgenceState): Record<string, QuestionView> {
  const out: Record<string, QuestionView> = {}
  for (const question of state.questions) {
    if (question.answer !== null && question.answer !== undefined) continue
    out[question.id] = {
      id: question.id,
      question: question.question,
      options: question.options,
      isMerge: typeof question.action === 'string' && question.action.startsWith('merge:'),
    }
  }
  return out
}
