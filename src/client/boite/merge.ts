// The projects' agence snapshots, merged into the inbox's rows. Pure.

import type { AgenceSnapshot, NeedRow } from '@panels/agence/contract'
import type { Ligne, LigneAction, ProjectInput, ProjectView } from './types'

const repoOf = ({ root, snapshot }: ProjectInput): string =>
  snapshot?.suivi?.repo ?? root.split('/').filter(Boolean).pop() ?? root

const running = ({ snapshot }: ProjectInput): boolean => snapshot?.regisseur.state === 'running'

function actionOf(row: NeedRow, snapshot: AgenceSnapshot): LigneAction {
  const { action } = row
  if (action?.type === 'draft') {
    const draft = snapshot.drafts[action.draftId]
    if (draft) return { type: 'draft', draftId: draft.id, kind: draft.kind, hash: draft.hash, texte: draft.texte, inFlight: action.inFlight }
  } else if (action?.type === 'question') {
    const question = snapshot.questions[action.questionId]
    if (question) return { type: 'question', questionId: question.id, options: question.options, isMerge: question.isMerge, locks: question.locks, ghUnknown: question.ghUnknown, rebase: question.rebase }
  } else if (row.perm?.choix) {
    return { type: 'perm', command: row.perm.commande, reason: row.perm.motif, genre: row.perm.genre }
  }
  return { type: 'link' }
}

const time = (iso: string): number => Date.parse(iso) || 0

const byPriority = (a: Ligne, b: Ligne): number =>
  Number(b.blocking) - Number(a.blocking)
  || time(a.waitingSince) - time(b.waitingSince)
  || a.repo.localeCompare(b.repo)
  || a.root.localeCompare(b.root)
  || a.needId.localeCompare(b.needId)

/** Every project, and the rows « bloquant » and « à faire » of the live
 *  ones' follow-up, blocking first, then the oldest wait, then repo and root.
 *  Two panels on one root give one row per key, from the one whose regisseur runs. */
export function merge(inputs: readonly ProjectInput[]): { projects: ProjectView[]; rows: Ligne[] } {
  const projects = inputs.map(({ workspaceId, panelId, root, ...rest }): ProjectView => ({ workspaceId, panelId, root, repo: repoOf({ workspaceId, panelId, root, ...rest }) }))
  const seen = new Set<string>()
  const rows: Ligne[] = []
  for (const input of [...inputs].sort((a, b) => Number(running(b)) - Number(running(a)))) {
    const { snapshot, workspaceId, panelId, root } = input
    if (!snapshot?.suivi) continue
    const { bloquant, aFaire } = snapshot.suivi.sections
    for (const row of [...bloquant, ...aFaire]) {
      const key = `${root}#${row.id}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        key,
        workspaceId,
        panelId,
        root,
        repo: repoOf(input),
        needId: row.id,
        title: row.title,
        blocking: bloquant.includes(row),
        waitingSince: row.created ?? '',
        action: actionOf(row, snapshot),
        links: row.links,
      })
    }
  }
  return { projects, rows: rows.sort(byPriority) }
}
