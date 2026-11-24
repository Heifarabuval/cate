import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { shortcutDisplay, shortcutRegistry } from '@kernel/interaction'
import { keyOutcome, type BoiteCommand } from '@client/boite'
import type { PanelViewProps } from '../../client/host/views'
import { InlineNotice } from '../../kernel/interaction'
import { useLeaving } from '../agence/useLeaving'
import Ligne from './Ligne'
import { BOITE_ACTIONS, bindBoiteKeys } from './keyboard'
import { useBoite } from './useBoite'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The validation inbox: what waits for the human in every project open in this client. */
export default function BoiteView({ panelId }: PanelViewProps) {
  const { projects, rows, closedWorkspaces, actions, actionsState } = useBoite()
  // The selection is a line's key, never its position: it stays on its line when the list moves.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const latest = useRef({ rows, shown: actionsState.shown, actions, selectedKey })
  latest.current = { rows, shown: actionsState.shown, actions, selectedKey }
  useEffect(() => bindBoiteKeys(panelId, (command: BoiteCommand) => {
    const { rows, shown, actions, selectedKey } = latest.current
    const outcome = keyOutcome(command, { rows, selectedKey, shown })
    if (!outcome) return
    // Two presses before the next render read the selection the first one set.
    latest.current.selectedKey = outcome.key
    setSelectedKey(outcome.key)
    if (outcome.type === 'show') actions.show(outcome.key)
    else if (outcome.type === 'send') void actions.send(outcome.key)
  }), [panelId])
  const now = Date.now()
  // One list, most urgent first: what blocks comes before the rest, the order of the rows kept inside each.
  const ordered = [...rows.filter((row) => row.blocking), ...rows.filter((row) => !row.blocking)]
  // A line answered or sent folds away in place; a new one fades in.
  const shown = useLeaving(ordered, (row) => row.key)
  // A project with no line yet says why: still read, or unreadable. Never « Rien ne t'attend » over it.
  const withRows = new Set(rows.map((row) => row.root))
  const unsettled = projects.filter((project) => project.state !== 'live' && !withRows.has(project.root))
  const watched = [
    plural(projects.length, 'projet surveillé', 'projets surveillés'),
    ...(closedWorkspaces > 0 ? [plural(closedWorkspaces, 'workspace non ouvert', 'workspaces non ouverts')] : []),
  ].join(' · ')

  const resolved = shortcutRegistry().resolved()
  const keyOf = (id: keyof typeof BOITE_ACTIONS) => shortcutDisplay(resolved, id) ?? '-'
  const help = `${keyOf('boite.next')} ${keyOf('boite.previous')} ligne · ${keyOf('boite.open')} afficher · ${keyOf('boite.send')} envoyer · ${keyOf('boite.skip')} passer`

  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto bg-surface-1">
      {projects.length === 0 && <p className="p-4 text-[12px] text-secondary">Aucun projet orchestré dans les workspaces ouverts.</p>}
      {projects.length > 0 && shown.length === 0 && unsettled.length === 0 && (
        <p className="flex animate-sidebar-view-in items-center gap-2 p-4 text-[13px] text-primary motion-reduce:animate-none"><Check aria-hidden size={14} className="text-secondary" />Rien ne t&apos;attend.</p>
      )}
      {shown.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
            <span>À toi</span>
            <span className="rounded-full bg-surface-4 px-1.5 font-medium tabular-nums">{rows.length}</span>
          </h2>
          <ul>{shown.map(({ item, entering, leaving }) => <Ligne key={item.key} ligne={item} now={now} actions={actions} state={actionsState} selected={item.key === selectedKey} enter={entering} leaving={leaving} />)}</ul>
        </section>
      )}
      {unsettled.map((project) => project.state === 'error'
        ? <InlineNotice key={`${project.workspaceId}/${project.panelId}`} tone="error" data-testid="projet-erreur" className="mx-3 mt-2 break-words !text-primary">{`${project.repo} : ${project.error}`}</InlineNotice>
        : <p key={`${project.workspaceId}/${project.panelId}`} data-testid="projet-attente" className="mx-3 mt-2 break-words text-[12px] text-secondary">{`${project.repo} : ${project.error}`}</p>)}
      <p className="mt-auto px-3 pt-2 text-[11px] text-secondary">{watched}</p>
      <p data-testid="raccourcis" className="px-3 pb-2 text-[11px] text-secondary">{help}</p>
    </div>
  )
}
