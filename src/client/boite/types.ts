// The validation inbox's data: what a client reads of the agence panels of the
// workspaces it has open, and the rows it merges them into
// (specs/003-boite-validation/data-model.md). Pure; the inbox writes nothing.

import type { AgenceSnapshot, DraftKind } from '@panels/agence/contract'

/** One agence panel of an open workspace: a project. `snapshot` is null until
 *  its session sent the first one. */
export interface ProjectInput {
  workspaceId: string
  panelId: string
  /** The repository root: `fields.root` of the panel, else the workspace's. */
  root: string
  snapshot: AgenceSnapshot | null
}

export interface ProjectView {
  workspaceId: string
  panelId: string
  root: string
  repo: string
}

export type LigneAction =
  /** `texte` is what `hash` is the hash of: what the human reads before sending. */
  | { type: 'draft'; draftId: string; kind: DraftKind; hash: string; texte: string; inFlight: boolean }
  | { type: 'question'; questionId: string; options: Array<{ label: string; detail: string }>; isMerge: boolean; locks: string[]; ghUnknown: boolean; rebase: boolean }
  /** An agent waits on a permission whose screen was readable: Oui or Non, with the whole command and its reason. */
  | { type: 'perm'; command: string; reason: string; genre: string }
  /** Nothing to answer from here: only the link to the panel. */
  | { type: 'link' }

export interface Ligne {
  /** `${root}#${needId}`: the identity of a row, never its position. */
  key: string
  /** Where an action is relayed. */
  workspaceId: string
  panelId: string
  root: string
  repo: string
  needId: string
  title: string
  /** Sorted first. */
  blocking: boolean
  /** ISO time the need was created. */
  waitingSince: string
  action: LigneAction
  links: Array<{ panelId: string; title: string; closed: boolean }>
}

export interface BoiteSnapshot {
  /** The projects watched, the ones with no row included (« N projets »). */
  projects: ProjectView[]
  rows: Ligne[]
  /** Workspaces this client knows and has not opened: not watched. */
  closedWorkspaces: number
}
