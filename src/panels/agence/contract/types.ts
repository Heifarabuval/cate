// Agence panel state, snapshot and ops. Pure. The panel reads the `agence`
// CLI's state files (`<root>/.cate/tmp/agence/`) and never writes them: every
// action goes through the CLI's regisseur (specs/002-panneau-agence).

import type { PanelCreateOptions } from '@panels/framework/contract'

export type OrchestratorState = 'starting' | 'running' | 'exited' | 'failed'

export type RegisseurView = {
  state: 'starting' | 'running' | 'stopped' | 'external' | 'missing'
  error: string | null
  /** The regisseur's stderr hint when the `cate` CLI settings are off. */
  settingsHint: string | null
}

export type DraftKind = 'issue' | 'pr' | 'comment' | 'slack' | 'mail'

export type DraftView = {
  id: string
  cible: string
  kind: DraftKind
  titre: string | null
  statut: string
  texte: string
  /** sha256 hex of `texte.trim()`; `draft.send` carries the one the view showed. */
  hash: string
  /** Slack send of unknown outcome: the regisseur refuses a plain send; only `confirme` resends. */
  incertain?: true
}

export type QuestionView = {
  id: string
  question: string
  /** `fait`: this option was already taken (its click is gone): shown greyed, never clickable. */
  options: Array<{ label: string; detail: string; fait?: true }>
  isMerge: boolean
  /** Why Merger is greyed (needs that target the PR, then the GitHub motif);
   *  « Merger quand même » passes over them. */
  locks: string[]
  /** The PR's GitHub state is unknown or stale. */
  ghUnknown: boolean
  /** A conflict: « Demander le rebase » is offered. */
  rebase: boolean
  /** The merge method the policy publishes (`squash`, `rebase`, `merge`); absent without a policy. Merge questions only. */
  methode?: string
}

export type NeedLink = { panelId: string; title: string; closed: boolean }

export type NeedAction =
  | { type: 'draft'; draftId: string; inFlight: boolean }
  /** `rebase`: Merger is greyed by a conflict, « Demander le rebase » is offered. */
  | { type: 'question'; questionId: string; rebase: boolean }
  /** The regisseur offers to remove the worktree of a merged need: Supprimer or Garder. */
  | { type: 'worktree'; branch: string }
  /** A panel left without an agent: Fermer or Garder. */
  | { type: 'orphan' }

/** The permission an agent waits on, as the regisseur read it from the agent's
 *  screen. `choix`: Oui and Non can be sent from here (readable screen, not
 *  answered yet); otherwise only the agent's own panel answers. */
export type NeedPerm = { genre: string; commande: string; motif: string; choix: boolean }

export type NeedRow = {
  id: string
  title: string
  kind: string
  /** The mentions of `need_line` in agence.py. */
  meta: string[]
  evidence: string | null
  /** ISO time the need was created (how long it has waited); absent from a state without it. */
  created?: string
  /** The #N of a PR or an issue, as a link; null when the repository is unknown. */
  link: { label: string; href: string } | null
  links: NeedLink[]
  action: NeedAction | null
  /** Set while an agent is blocked on a permission the regisseur could read. */
  perm?: NeedPerm | null
}

export type SuiviSections = {
  bloquant: NeedRow[]
  aFaire: NeedRow[]
  fait: NeedRow[]
  reste: NeedRow[]
}

export type SuiviView = {
  repo: string
  /** The human's name, shown in « À faire par <name> » (`agence nom`). */
  humain: string
  agentsActive: number
  /** ISO time of the last state read. */
  readAt: string
  /** The state file was unreadable: the previous state is kept. */
  error: string | null
  sections: SuiviSections
}

/** A value of the policy (`pratiques.json` of the CLI): a scalar or a list of them. */
export type PratiqueValeur = string | number | boolean | null | PratiqueValeur[]

/** The policy the CLI published in its state (spec 005): the effective value of
 *  each key and where it comes from (`défaut`, `dev`, `projet`; `preset` names the
 *  preset's own source). `erreur`: the file that is invalid, the CLI having fallen
 *  back to the neutral preset. */
export type PratiquesView = {
  preset: string
  valeurs: Record<string, PratiqueValeur>
  sources: Record<string, string>
  erreur: string | null
  /** The form view (spec 008, `vue()` of the CLI; contract: `contract/fixtures/vue-reglages.json`).
   *  Absent from an older CLI. */
  champs?: PratiqueChamp[]
  presets?: PratiquePreset[]
  /** The project's file exists; false asks the first questions before the orchestrator starts. */
  projet?: boolean
  /** How many keys this workspace's file sets (its preset not counted). */
  nbProjet?: number
  /** The rules no setting changes, in words, without a control. */
  invariants?: string[]
}

/** How a setting is chosen: one named value, an integer within bounds, free text, several named values. */
export const PRATIQUE_FORMES = ['valeurs', 'entier', 'motif', 'liste'] as const
export type PratiqueForme = typeof PRATIQUE_FORMES[number]

/** One setting as the regisseur publishes it, already in words: the view renders it without knowing any key. */
export type PratiqueChamp = {
  cle: string
  nom: string
  explique: string
  groupe: 'essentiel' | 'avance'
  /** `dev`: the person's file for all their projects, on the runtime's machine. */
  portee: 'workspace' | 'dev'
  /** The first questions' wording; null for a setting they do not ask. */
  question: string | null
  forme: PratiqueForme
  /** One label per allowed value (`valeurs`, `liste`); null otherwise. */
  choix: Array<{ valeur: PratiqueValeur; libelle: string }> | null
  /** `entier`: lowest and highest. */
  bornes: [number, number] | null
  /** What a null value means, in words. */
  vide: string | null
  /** The default preset's value. */
  defaut: PratiqueValeur
  valeur: PratiqueValeur
  /** `défaut`, `dev`, `projet` or `ponctuel`. */
  origine: string
}

/** At most this many questions before the orchestrator first starts (spec 008, SC-006). */
export const MAX_QUESTIONS = 4

/** The first questions (spec 008, US3): the essential fields that carry a question,
 *  in the order published, at most `MAX_QUESTIONS`. */
export function premieresQuestions(champs: PratiqueChamp[]): PratiqueChamp[] {
  return champs.filter((champ) => champ.groupe === 'essentiel' && champ.question).slice(0, MAX_QUESTIONS)
}

export type PratiquePreset = { id: string; nom: string; explique: string; actif: boolean }

/** The preset « Passer » and « Repartir des réglages par défaut » write (`DEFAUT` of the CLI's policy module). */
export const PRESET_DEFAUT = 'neutre'

/** The states of a fiche (`ETATS` of tools/agence/backlog.py). */
export const FICHE_ETATS = ['discussion', 'prête', 'lancée', 'faite', 'abandonnée'] as const
export type FicheEtat = typeof FICHE_ETATS[number]

/** A fiche as the regisseur publishes it (spec 010, lot 4); field names of backlog.py.
 *  `consomme`: input + output tokens of the need's panels, null when no measure was readable. */
export type FicheView = {
  id: string
  titre: string
  etat: FicheEtat
  priorite: string | null
  budgetJetons: number | null
  consomme: number | null
}

/** The `backlog` field of the CLI's state, served as is (`contract/fixtures/vue-backlog.json`):
 *  the last plan of the prêtes (`vagues`, `attentes`: id to motif) and the file error,
 *  under which nothing is launched. */
export type BacklogView = {
  fiches: FicheView[]
  vagues: string[][]
  attentes: Record<string, string>
  /** Prêtes already queued by a click (waiting for a place): skipped by « Lancer », not counted in its n. */
  enFile: string[]
  erreur: string | null
}

/** Consumed against budget over the lancées: each sum is null as soon as one of its
 *  terms is unknown (a partial sum would read as less than spent or allowed);
 *  null without a lancée. */
export function totalLot(fiches: FicheView[]): { consomme: number | null; budget: number | null } | null {
  const lancees = fiches.filter((fiche) => fiche.etat === 'lancée')
  if (lancees.length === 0) return null
  const sum = (values: Array<number | null>): number | null =>
    values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + value!, 0)
  return {
    consomme: sum(lancees.map((fiche) => fiche.consomme)),
    budget: sum(lancees.map((fiche) => fiche.budgetJetons)),
  }
}

export type AgenceSnapshot = {
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
  /** The send guard of the human's `~/.claude/settings.json`, as the regisseur
   *  last read it (`agence hooks status`); `inconnu` before its first turn. */
  garde: GardeState
  /** Null: the CLI publishes no policy (old CLI) or is missing. Optional so the
   *  other clients' fixtures (the boite's) need no change. */
  pratiques?: PratiquesView | null
  /** Null: the CLI publishes no backlog (old CLI) or is missing. Optional like `pratiques`. */
  backlog?: BacklogView | null
}

export type GardeState = 'actif' | 'inactif' | 'partiel' | 'inconnu'

export type AgenceOp =
  | { kind: 'draft.send'; draftId: string; hash: string; confirme?: boolean }
  | { kind: 'draft.drop'; draftId: string }
  | { kind: 'draft.edit'; draftId: string }
  /** `choice`: an option's index, or `rebase` (a conflict: the orchestrator
   *  has the PR rebased); `force`: « Merger quand même » over the locks. */
  | { kind: 'answer'; questionId: string; choice?: number | 'rebase'; libre?: string; force?: boolean }
  | { kind: 'orchestrator.restart' }
  /** Oui or Non to the permission an agent waits on (need `needId`): the
   *  regisseur re-reads the agent's screen before it types. */
  | { kind: 'perm'; needId: string; reponse: 'oui' | 'non' }
  /** Supprimer or Garder the worktree the regisseur offers on need `needId` (it re-checks the worktree before it removes). */
  | { kind: 'worktree'; needId: string; choix: 'remove' | 'keep' }
  /** Fermer or Garder the panel without an agent of need `needId`. */
  | { kind: 'orphan'; needId: string; choix: 'close' | 'keep' }
  /** One setting of the form, written by the regisseur (`/pratiques/set`) in the file its scope names. */
  | { kind: 'pratique.set'; cle: string; valeur: PratiqueValeur }
  /** « Revenir au défaut »: the key leaves the file. */
  | { kind: 'pratique.unset'; cle: string }
  /** A preset; `remplacer`: the file keeps the preset alone. */
  | { kind: 'pratique.preset'; nom: string; remplacer?: boolean }
  /** The end of the first questions: every answer in one write, or `passer` (the default
   *  preset); then the orchestrator starts. Without effect once they are over. */
  | { kind: 'pratique.questions'; reponses?: Record<string, PratiqueValeur>; passer?: boolean }
  /** « Lancer » on the checked prêtes: the regisseur plans the waves and creates the needs. */
  | { kind: 'fiches.lancer'; ids: string[] }

/** Why an op was refused. */
export type AgenceOpError = 'busy' | 'conflict' | 'unavailable' | 'invalid'

/** What an op answers: refusals are answers, not errors. `message` is the
 *  regisseur's own wording (« texte a changé », ...) for the view to show. */
export type AgenceOpResult = { ok: true } | { ok: false; error: AgenceOpError; message?: string }

/** `sessions/<panelId>.json`: the last title seen of each linked panel. */
export type AgencePersisted = {
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
  /** Dollar budget (`need add --budget-usd`); absent from states written before it. */
  budgetUsd?: number | null
  evidence: string | null
  status: 'open' | 'done' | string
  closeFailed: boolean
  /** ISO time `add_need` wrote. */
  created?: string
  agentBlocked: boolean
  /** The permission read from the blocked agent's screen (`set_perm`); `choix` lists the keys when Oui/Non can be sent. */
  perm?: { genre: string; commande: string; motif: string; choix: string[]; panel: string } | null
  /** Signature of the permission already answered: its buttons are gone. */
  permAnswered?: string | null
  /** A merged need's worktree the regisseur offers to remove. */
  worktree?: { path: string; branch: string } | null
  /** A panel seen without an agent that the regisseur offers to close. */
  orphan?: { panel: string; title: string } | null
  /** True for a minutes overrun and for a dollar one. */
  overBudget: boolean
  overBudgetUsd?: boolean
  /** Last cost read per agent panel, in dollars; null when Cate gives none. */
  costByPanel?: Record<string, number | null>
  updated: string
}

export interface StateDraft {
  id: string
  needId: string
  cible: string
  titre: string | null
  statut: string
  url: string | null
  /** `HH:MM` of the last edit through Modifier. */
  modifie?: string | null
  /** Slack send of unknown outcome (`confirme=1` resends). */
  incertain?: boolean
  /** Why the draft can no longer leave (a PR whose branch is gone), as the regisseur last checked; null or absent when it can. */
  perime?: string | null
}

export interface StateQuestion {
  id: string
  needId: string
  question: string
  options: Array<{ label: string; detail: string }>
  /** `merge:<repo>#<number>`: answering the first option merges. */
  action: string | null
  answer: string | null
  /** A regisseur card: the click of each option; null once that option was taken. */
  clics?: Array<string | null> | null
  /** The PR's GitHub state as the regisseur last read it (`ts` in seconds). */
  gh?: { mergeable?: string; mergeStateStatus?: string; ts?: number } | null
}

/** The part of the CLI's state the panel reads. */
export interface AgenceState {
  repo: string
  /** The human's name, written by the regisseur at each turn; absent in an old state. */
  humain?: string
  ghRepo: string | null
  agentsActive: number
  /** The regisseur's port, set by `agence boot`. */
  port: number | null
  panels: Record<string, string>
  titles: Record<string, string>
  needs: StateNeed[]
  drafts: StateDraft[]
  questions: StateQuestion[]
  /** Written by the regisseur at each turn; absent or null in an old state. */
  garde?: string | null
  /** Written by `agence watch` each round (spec 005); absent in an old state. */
  pratiques?: PratiquesView | null
  /** Written by the regisseur each turn (spec 010, lot 4); absent in an old state. */
  backlog?: unknown
}

/** What the document says of a linked panel: its last known title, and
 *  whether it is gone. */
export type PanelTitles = Record<string, { title: string; closed: boolean }>
