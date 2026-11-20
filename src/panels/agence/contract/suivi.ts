// The follow-up classification of the CLI's state: `page_suivi` and
// `need_line` of agence.py, as a pure function. Same sections, same order,
// same mentions. `now` (ms) decides whether a PR's GitHub state is fresh.

import type { AgenceState, NeedRow, PanelTitles, StateNeed, StateQuestion, SuiviSections } from './types'

const DONE_SHOWN = 20
/** The stored `owner` of the human's needs (OWNER_HUMAIN of agence.py): an opaque key, never shown. */
export const OWNER_HUMAIN = 'heifara'
/** Shown until the regisseur has written the name (old state). */
export const HUMAIN_DEFAUT = "L'humain"
/** Seconds after which the GitHub state read by the regisseur is ignored (GH_PERIME). */
const GH_STALE_S = 300
const CONFLICT = 'conflit avec la base'
const MOTIFS: Record<string, string> = { DIRTY: CONFLICT, BLOCKED: 'checks ou revue requis', UNSTABLE: 'checks en échec' }

const ghFresh = (question: StateQuestion, now: number) => {
  const gh = question.gh ?? {}
  return now / 1000 - (gh.ts ?? 0) <= GH_STALE_S ? gh : null
}

/** Why the PR cannot be merged on GitHub, from a fresh state only (merge_motif). */
const mergeMotif = (question: StateQuestion, now: number): string | undefined => {
  const gh = ghFresh(question, now) ?? {}
  return gh.mergeable === 'CONFLICTING' ? CONFLICT : MOTIFS[gh.mergeStateStatus ?? '']
}

/** Does the text cite PR repo#num (vise_pr)? « owner/repo#N » and « repo#N »
 *  only name that repository; a bare « #N » or « PR N », the project's. */
function citesPr(text: string, repo: string, num: string, project: string | null): boolean {
  const pattern = new RegExp(`(?:(?:([\\p{L}\\p{N}_.-]+)/)?([\\p{L}\\p{N}_.-]+))?#${num}(?!\\d)|\\bPR\\s*${num}(?!\\d)`, 'giu')
  for (const [, owner, name] of text.matchAll(pattern)) {
    if (name) {
      if ((owner ? `${owner}/${name}` : name).toLowerCase() === (owner ? repo : repo.split('/')[1] ?? '').toLowerCase()) return true
    } else if (project === null || project.toLowerCase() === repo.toLowerCase()) return true
  }
  return false
}

/** A merge question's state (merge_locks): why Merger is greyed (open needs
 *  that target the PR, then the GitHub motif), whether the GitHub state is
 *  unknown, whether the rebase is offered. */
export function mergeState(state: AgenceState, question: StateQuestion, now: number): { locks: string[]; ghUnknown: boolean; rebase: boolean } {
  if (!question.action?.startsWith('merge:')) return { locks: [], ghUnknown: false, rebase: false }
  const [repo, num = ''] = question.action.slice('merge:'.length).split('#')
  const locks = state.needs
    .filter((need) => need.status === 'open' && need.id !== question.needId
      && (((need.kind === 'pr' || need.kind === 'issue') && need.ref === num && (state.ghRepo === null || state.ghRepo === repo))
        || citesPr(need.unblocks ?? '', repo, num, state.ghRepo)))
    .map((need) => `${need.id} : ${need.title}`)
  const motif = mergeMotif(question, now)
  if (motif) locks.push(motif)
  return { locks, ghUnknown: !ghFresh(question, now), rebase: locks.length > 0 && motif === CONFLICT }
}

function row(state: AgenceState, need: StateNeed, titles: PanelTitles, now: number): NeedRow {
  const links = need.panels.flatMap((panelId) => titles[panelId]?.title ? [{ panelId, title: titles[panelId].title, closed: titles[panelId].closed }] : [])
  const meta: string[] = []
  let link: NeedRow['link'] = null
  if ((need.kind === 'pr' || need.kind === 'issue') && need.ref && state.ghRepo) {
    link = { label: `#${need.ref}`, href: `https://github.com/${state.ghRepo}/${need.kind === 'pr' ? 'pull' : 'issues'}/${need.ref}` }
    meta.push(link.label)
  }
  if (need.unblocks) meta.push(`débloque ${need.unblocks}`)
  if (need.acceptance) meta.push(`acceptation : ${need.acceptance}`)
  if (need.overBudgetUsd) {
    const costs = Object.values(need.costByPanel ?? {}).filter((cost): cost is number => cost !== null)
    const spent = costs.reduce((sum, cost) => sum + cost, 0)
    meta.push(`budget de ${(need.budgetUsd ?? 0).toFixed(2)} $ dépassé (coût ${spent.toFixed(2).replace('.', ',')} $) : continuer, réduire ou arrêter ?`)
  } else if (need.overBudget && need.budgetMin) {
    meta.push(`budget de ${need.budgetMin} min dépassé : continuer, réduire ou arrêter ?`)
  }
  if (need.agentBlocked) meta.push('agent bloqué sur une permission ou une question')
  if (need.closeFailed) meta.push('fermeture refusée (travail non sauvegardé ou programme en cours) : à fermer à la main')
  const evidence = need.status === 'done' && need.evidence ? need.evidence : null
  if (evidence) meta.push(`preuve : ${evidence}`)
  if (need.kind === 'draft') {
    for (const draft of state.drafts) if (draft.id === need.ref && draft.modifie) meta.push(`modifié à ${draft.modifie}`)
  }
  if (links.length) meta.push(`panneau : ${links.map((link) => link.title).join(', ')}`)
  let action: NeedRow['action'] = null
  if (need.status === 'open' && need.kind === 'draft' && need.ref) {
    action = { type: 'draft', draftId: need.ref, inFlight: state.drafts.some((draft) => draft.id === need.ref && draft.statut === 'envoyer') }
  } else if (need.status === 'open' && need.kind === 'human' && need.ref?.startsWith('q')) {
    const question = state.questions.find((candidate) => candidate.id === need.ref)
    const merge = question ? mergeState(state, question, now) : null
    if (question?.action && merge?.ghUnknown) meta.push('état GitHub inconnu')
    if (merge?.locks.length) meta.push(`Merger grisé : ${merge.locks.join(' ; ')}`)
    action = { type: 'question', questionId: need.ref, rebase: merge?.rebase ?? false }
  }
  return { id: need.id, title: need.title, kind: need.kind, meta, evidence, created: need.created, link, links, action }
}

export function classify(state: AgenceState, titles: PanelTitles, now: number): SuiviSections {
  const open = state.needs.filter((need) => need.status === 'open')
  const mine = open.filter((need) => need.owner === OWNER_HUMAIN)
  const blocked = open.filter((need) => need.owner !== OWNER_HUMAIN && (need.blocking || need.overBudget || need.agentBlocked || need.closeFailed))
  const rest = open.filter((need) => !mine.includes(need) && !blocked.includes(need))
  // Newest first; equal dates keep the state's order, as Python's reverse sort does.
  const done = state.needs.filter((need) => need.status === 'done')
    .map((need, index) => ({ need, index }))
    .sort((a, b) => (a.need.updated < b.need.updated ? 1 : a.need.updated > b.need.updated ? -1 : a.index - b.index))
    .slice(0, DONE_SHOWN).map(({ need }) => need)
  const rows = (needs: StateNeed[]) => needs.map((need) => row(state, need, titles, now))
  return { bloquant: rows(blocked), aFaire: rows(mine), fait: rows(done), reste: rows(rest) }
}
