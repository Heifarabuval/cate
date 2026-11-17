// Agence panel state, snapshot and ops. Pure. The panel reads the `agence`
// CLI's state files (`<root>/.cate/tmp/agence/`) and never writes them: every
// action goes through the CLI's regisseur (specs/002-panneau-agence).

import type { PanelCreateOptions } from '@panels/framework/contract'

export type OrchestratorState = 'starting' | 'running' | 'exited' | 'failed'

export interface RegisseurView {
  state: 'starting' | 'running' | 'stopped' | 'external' | 'missing'
  error: string | null
  /** The regisseur's stderr hint when the `cate` CLI settings are off. */
  settingsHint: string | null
}

export type DraftKind = 'issue' | 'pr' | 'comment' | 'slack' | 'mail'

export interface DraftView {
  id: string
  cible: string
  kind: DraftKind
  titre: string | null
  statut: string
  texte: string
  /** sha256 hex of `texte.trim()`; `draft.send` carries the one the view showed. */
  hash: string
}

export interface QuestionView {
  id: string
  question: string
  options: Array<{ label: string; detail: string }>
  isMerge: boolean
}

export interface NeedLink { panelId: string; title: string; closed: boolean }

export type NeedAction =
  | { type: 'draft'; draftId: string; inFlight: boolean }
  | { type: 'question'; questionId: string }

export interface NeedRow {
  id: string
  title: string
  kind: string
  /** The mentions of `need_line` in agence.py. */
  meta: string[]
  evidence: string | null
  links: NeedLink[]
  action: NeedAction | null
}

export interface SuiviSections {
  bloquant: NeedRow[]
  aFaire: NeedRow[]
  fait: NeedRow[]
  reste: NeedRow[]
}

export interface SuiviView {
  repo: string
  agentsActive: number
  /** ISO time of the last state read. */
  readAt: string
  /** The state file was unreadable: the previous state is kept. */
  error: string | null
  sections: SuiviSections
}

export interface AgenceSnapshot {
  /** The orchestrator's PTY, for `process.attach`. */
  ptyId: string | null
  orchestrator: OrchestratorState
  regisseur: RegisseurView
  /** Null: `agence` is missing or no state was ever read. */
  suivi: SuiviView | null
  /** Open drafts (statut `à valider` or `envoyer`). */
  drafts: Record<string, DraftView>
  /** Questions with no answer. */
  questions: Record<string, QuestionView>
}

export type AgenceOp =
  | { kind: 'draft.send'; draftId: string; hash: string }
  | { kind: 'draft.drop'; draftId: string }
  | { kind: 'draft.edit'; draftId: string }
  | { kind: 'answer'; questionId: string; choice?: number; libre?: string }
  | { kind: 'orchestrator.restart' }

/** Why an op was refused (`{ ok: false, error }`). */
export type AgenceOpError = 'busy' | 'conflict' | 'unavailable' | 'invalid'

/** `sessions/<panelId>.json`: the last title seen of each linked panel. */
export interface AgencePersisted {
  knownTitles: Record<string, string>
}

/** The record's fields: the repository root, the workspace root by default. */
export interface AgenceFields {
  root?: string
}

export interface AgenceCreateOptions extends PanelCreateOptions {
  root?: string
}

/** A need of the CLI's state (`add_need` in agence.py). */
export interface StateNeed {
  id: string
  kind: string
  title: string
  ref: string | null
  owner: string
  blocking: boolean
  unblocks: string | null
  panels: string[]
  acceptance: string | null
  budgetMin: number | null
  evidence: string | null
  status: 'open' | 'done' | string
  closeFailed: boolean
  agentBlocked: boolean
  overBudget: boolean
  updated: string
}

export interface StateDraft {
  id: string
  needId: string
  cible: string
  titre: string | null
  statut: string
  url: string | null
}

export interface StateQuestion {
  id: string
  needId: string
  question: string
  options: Array<{ label: string; detail: string }>
  answer: string | null
}

/** The part of the CLI's state the panel reads. */
export interface AgenceState {
  repo: string
  ghRepo: string | null
  agentsActive: number
  panels: Record<string, string>
  titles: Record<string, string>
  needs: StateNeed[]
  drafts: StateDraft[]
  questions: StateQuestion[]
}

/** What the document says of a linked panel: its last known title, and
 *  whether it is gone. */
export type PanelTitles = Record<string, { title: string; closed: boolean }>
