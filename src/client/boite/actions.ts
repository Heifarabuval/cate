// What the human does from the inbox: each action is an op of the agence panel
// of the line's own project, relayed by the store (contracts/relais.md). The
// regisseur's `click()` and its token stay in the project's daemon; nothing
// here reads or holds a token. A line is always found by its key at the moment
// of the click, never by its position, and one click is one action.

import type { AgenceOp, AgenceOpResult } from '@panels/agence/contract'
import { focusPanel, revealPanel } from '@client/host'
import type { BoiteStore } from './store'
import type { Ligne, LigneAction } from './types'

export type ActionResult = AgenceOpResult

export type ShowResult = { ok: true; texte: string } | { ok: false; error: 'invalid' | 'unavailable' }

/** What the views show of the actions in flight. Immutable: a new object on each change. */
export interface ActionsState {
  /** Lines with an action sent and not yet gone from the list: they take no second click. */
  readonly busy: ReadonlySet<string>
  /** The hash of the draft text each line displayed: the only hash `send` relays. */
  readonly shown: Readonly<Record<string, string>>
  /** The last refusal of each line, in the regisseur's own words. */
  readonly notices: Readonly<Record<string, string>>
}

export interface AnswerChoice {
  /** The question the card showed: an answer for another one (it changed under the card) is refused. */
  questionId: string
  choice?: number | 'rebase'
  libre?: string
  force?: boolean
}

export interface BoiteActions {
  getState(): ActionsState
  subscribe(listener: () => void): () => void
  /** Answers a question. A free answer wins over a choice, as in the regisseur's `click()`. */
  answer(key: string, choice: AnswerChoice): Promise<ActionResult>
  /** Merger: the first option of a merge question. Greyed (locks) it takes `force`, as « Merger quand même ». */
  merge(key: string, choice: Pick<AnswerChoice, 'questionId' | 'force'>): Promise<ActionResult>
  /** Displays a draft: notes the hash of the text shown, the one `send` will carry. */
  show(key: string): ShowResult
  /** Sends the draft whose text was shown, and no other. */
  send(key: string): Promise<ActionResult>
  /** Oui or Non to the permission an agent waits on. */
  perm(key: string, reponse: 'oui' | 'non'): Promise<ActionResult>
  /** Supprimer or Garder the worktree, Fermer or Garder the panel without an agent, as the line offers. */
  offer(key: string, choix: 'remove' | 'close' | 'keep'): Promise<ActionResult>
  /** Brings a linked panel of the line on screen and focuses it; without `panelId`, the project's agence panel. Always allowed, greyed line or not. */
  open(key: string, panelId?: string): Promise<ActionResult>
  /** Relaunches the project's own orchestrator and regisseur through its agence session. Busy when the project runs: no second regisseur. */
  restart(project: { workspaceId: string; panelId: string }): Promise<ActionResult>
}

const EMPTY: ActionsState = { busy: new Set(), shown: {}, notices: {} }

const isResult = (value: unknown): value is ActionResult =>
  typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'

export function createBoiteActions(store: Pick<BoiteStore, 'getSnapshot' | 'subscribe' | 'send'>): BoiteActions {
  const listeners = new Set<() => void>()
  let state = EMPTY
  let stopStore: (() => void) | null = null
  /** What each accepted line was showing when its op went: the line is free again once that changes. */
  const accepted = new Map<string, string>()
  const pending = new Set<string>()
  /** Projects with a restart in flight. */
  const restarting = new Set<string>()

  const set = (next: Partial<ActionsState>): void => {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }
  const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
    const { [key]: _gone, ...rest } = record
    return rest
  }
  const withNotice = (key: string, message: string | undefined) =>
    message === undefined ? { notices: without(state.notices, key) } : { notices: { ...state.notices, [key]: message } }
  const find = (key: string): Ligne | undefined => store.getSnapshot().rows.find((row) => row.key === key)
  const draftOf = (row: Ligne): Extract<LigneAction, { type: 'draft' }> | null => (row.action.type === 'draft' ? row.action : null)

  /** The list moved: what belongs to a line that left goes, and a text that changed under its display is no longer shown. */
  function prune(): void {
    const rows = new Map(store.getSnapshot().rows.map((row) => [row.key, row]))
    const keep = (key: string) => rows.has(key)
    for (const [key, fingerprint] of accepted) {
      if (!rows.has(key) || JSON.stringify(rows.get(key)!.action) !== fingerprint) accepted.delete(key)
    }
    const busy = new Set([...state.busy].filter((key) => keep(key) && (pending.has(key) || accepted.has(key))))
    const shown: Record<string, string> = {}
    const notices: Record<string, string> = {}
    for (const [key, message] of Object.entries(state.notices)) if (keep(key)) notices[key] = message
    for (const [key, hash] of Object.entries(state.shown)) {
      const draft = rows.has(key) ? draftOf(rows.get(key)!) : null
      if (!draft) continue
      if (draft.hash === hash) shown[key] = hash
      else notices[key] = 'texte a changé'
    }
    const same = busy.size === state.busy.size
      && Object.keys(shown).length === Object.keys(state.shown).length
      && JSON.stringify(notices) === JSON.stringify(state.notices)
    if (!same) set({ busy, shown, notices })
  }

  /** One op to an agence session; a refusal or a failure is an answer, never a throw. */
  async function toSession(workspaceId: string, panelId: string, op: AgenceOp): Promise<ActionResult> {
    try {
      const reply = await (store.send(workspaceId, panelId, op) ?? Promise.resolve(null))
      return reply === null ? { ok: false, error: 'unavailable', message: 'workspace fermé' } : isResult(reply) ? reply : { ok: false, error: 'unavailable' }
    } catch (error) {
      return { ok: false, error: 'unavailable', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** One op to the session of the line's project; the line is busy meanwhile, and after an accepted op until it leaves. */
  async function relay(key: string, op: (row: Ligne) => AgenceOp | 'changed' | null): Promise<ActionResult> {
    const row = find(key)
    if (!row) return { ok: false, error: 'unavailable', message: 'ligne introuvable' }
    // A greyed line (its project does not run) takes nothing but Relancer and the links.
    if (!row.enabled) return { ok: false, error: 'unavailable', message: row.reason ?? 'projet indisponible' }
    if (state.busy.has(key)) return { ok: false, error: 'busy' }
    const message = op(row)
    if (message === 'changed') {
      set(withNotice(key, 'la question a changé'))
      return { ok: false, error: 'conflict', message: 'la question a changé' }
    }
    if (!message) return { ok: false, error: 'invalid' }
    pending.add(key)
    set({ busy: new Set([...state.busy, key]), ...withNotice(key, undefined) })
    const result = await toSession(row.workspaceId, row.panelId, message)
    pending.delete(key)
    if (result.ok) {
      accepted.set(key, JSON.stringify(row.action))
      return result
    }
    set({ busy: new Set([...state.busy].filter((busy) => busy !== key)), ...withNotice(key, result.message ?? result.error) })
    return result
  }

  const answerOp = (choice: AnswerChoice) => (row: Ligne): AgenceOp | 'changed' | null => {
    if (row.action.type !== 'question') return null
    const { questionId } = row.action
    if (questionId !== choice.questionId) return 'changed'
    if (choice.libre) return { kind: 'answer', questionId, libre: choice.libre }
    return { kind: 'answer', questionId, ...(choice.choice !== undefined ? { choice: choice.choice } : {}), ...(choice.force ? { force: true } : {}) }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      stopStore ??= store.subscribe(prune)
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        stopStore?.()
        stopStore = null
        state = EMPTY
      }
    },
    answer: (key, choice) => relay(key, answerOp(choice)),
    // A greyed Merger (locks) goes only as « Merger quand même », forced.
    merge: (key, { questionId, force }) => relay(key, (row) =>
      row.action.type === 'question' && row.action.isMerge && (force || row.action.locks.length === 0)
        ? answerOp({ questionId, choice: 0, ...(force ? { force } : {}) })(row)
        : null),
    show(key) {
      const row = find(key)
      if (!row?.enabled) return { ok: false, error: 'unavailable' }
      const draft = draftOf(row)
      if (!draft) return { ok: false, error: 'invalid' }
      set({ shown: { ...state.shown, [key]: draft.hash }, ...withNotice(key, undefined) })
      return { ok: true, texte: draft.texte }
    },
    send: (key) => relay(key, (row) => {
      const draft = draftOf(row)
      const hash = state.shown[key]
      // No text shown, or not the one on the list now: nothing leaves.
      if (!draft || hash === undefined || hash !== draft.hash || draft.inFlight) return null
      return { kind: 'draft.send', draftId: draft.draftId, hash }
    }),
    async open(key, panelId) {
      const row = find(key)
      if (!row) return { ok: false, error: 'unavailable', message: 'ligne introuvable' }
      const target = panelId ?? row.panelId
      if (panelId !== undefined) {
        const link = row.links.find((candidate) => candidate.panelId === panelId)
        if (!link) return { ok: false, error: 'invalid' }
        if (link.closed) return { ok: false, error: 'unavailable', message: 'panneau fermé' }
      }
      if (!await revealPanel(row.workspaceId, target)) return { ok: false, error: 'unavailable', message: 'panneau introuvable' }
      focusPanel(row.workspaceId, target)
      return { ok: true }
    },
    async restart({ workspaceId, panelId }) {
      const project = store.getSnapshot().projects.find((candidate) => candidate.workspaceId === workspaceId && candidate.panelId === panelId)
      if (!project) return { ok: false, error: 'unavailable', message: 'projet introuvable' }
      const id = `${workspaceId}/${panelId}`
      // Everything runs, or a restart is on its way: nothing to start, never a second regisseur.
      if (project.state === 'live' || restarting.has(id)) return { ok: false, error: 'busy' }
      restarting.add(id)
      try {
        return await toSession(workspaceId, panelId, { kind: 'orchestrator.restart' })
      } finally {
        restarting.delete(id)
      }
    },
    perm: (key, reponse) => relay(key, (row) => (row.action.type === 'perm' ? { kind: 'perm', needId: row.needId, reponse } : null)),
    offer: (key, choix) => relay(key, (row) =>
      row.action.type === 'worktree' && choix !== 'close' ? { kind: 'worktree', needId: row.needId, choix }
        : row.action.type === 'orphan' && choix !== 'remove' ? { kind: 'orphan', needId: row.needId, choix }
          : null),
  }
}
