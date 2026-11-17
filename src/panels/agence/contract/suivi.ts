// The follow-up classification of the CLI's state: `page_suivi` and
// `need_line` of agence.py, as a pure function. Same sections, same order,
// same mentions.

import type { AgenceState, NeedRow, PanelTitles, StateNeed, SuiviSections } from './types'

const DONE_SHOWN = 20

function row(state: AgenceState, need: StateNeed, titles: PanelTitles): NeedRow {
  const links = need.panels.flatMap((panelId) => titles[panelId]?.title ? [{ panelId, title: titles[panelId].title, closed: titles[panelId].closed }] : [])
  const meta: string[] = []
  if ((need.kind === 'pr' || need.kind === 'issue') && need.ref && state.ghRepo) meta.push(`#${need.ref}`)
  if (need.unblocks) meta.push(`débloque ${need.unblocks}`)
  if (need.acceptance) meta.push(`acceptation : ${need.acceptance}`)
  if (need.overBudget) meta.push(`budget de ${need.budgetMin} min dépassé : continuer, réduire ou arrêter ?`)
  if (need.agentBlocked) meta.push('agent bloqué sur une permission ou une question')
  if (need.closeFailed) meta.push('fermeture refusée (travail non sauvegardé ou programme en cours) : à fermer à la main')
  const evidence = need.status === 'done' && need.evidence ? need.evidence : null
  if (evidence) meta.push(`preuve : ${evidence}`)
  if (links.length) meta.push(`panneau : ${links.map((link) => link.title).join(', ')}`)
  let action: NeedRow['action'] = null
  if (need.status === 'open' && need.kind === 'draft' && need.ref) {
    action = { type: 'draft', draftId: need.ref, inFlight: state.drafts.some((draft) => draft.id === need.ref && draft.statut === 'envoyer') }
  } else if (need.status === 'open' && need.kind === 'human' && need.ref?.startsWith('q')) {
    action = { type: 'question', questionId: need.ref }
  }
  return { id: need.id, title: need.title, kind: need.kind, meta, evidence, links, action }
}

export function classify(state: AgenceState, titles: PanelTitles): SuiviSections {
  const open = state.needs.filter((need) => need.status === 'open')
  const mine = open.filter((need) => need.owner === 'heifara')
  const blocked = open.filter((need) => need.owner !== 'heifara' && (need.blocking || need.overBudget || need.agentBlocked || need.closeFailed))
  const rest = open.filter((need) => !mine.includes(need) && !blocked.includes(need))
  // Newest first; equal dates keep the state's order, as Python's reverse sort does.
  const done = state.needs.filter((need) => need.status === 'done')
    .map((need, index) => ({ need, index }))
    .sort((a, b) => (a.need.updated < b.need.updated ? 1 : a.need.updated > b.need.updated ? -1 : a.index - b.index))
    .slice(0, DONE_SHOWN).map(({ need }) => need)
  const rows = (needs: StateNeed[]) => needs.map((need) => row(state, need, titles))
  return { bloquant: rows(blocked), aFaire: rows(mine), fait: rows(done), reste: rows(rest) }
}
