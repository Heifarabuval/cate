import { useEffect, useRef, useState } from 'react'
import { shortcutDisplay, shortcutRegistry } from '@kernel/interaction'
import { keyOutcome, type BoiteCommand } from '@client/boite'
import type { PanelViewProps } from '../../client/host/views'
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
  const sections = [
    { title: 'Bloquant', dot: 'bg-danger', rows: rows.filter((row) => row.blocking) },
    { title: 'À faire', dot: 'bg-warning', rows: rows.filter((row) => !row.blocking) },
  ].filter((section) => section.rows.length > 0)
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
      {projects.length > 0 && rows.length === 0 && <p className="p-4 text-[13px] text-primary">Rien ne t&apos;attend.</p>}
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="flex items-center gap-2 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${section.dot}`} />
            {section.title}
          </h2>
          <ul>{section.rows.map((row) => <Ligne key={row.key} ligne={row} now={now} actions={actions} state={actionsState} selected={row.key === selectedKey} />)}</ul>
        </section>
      ))}
      <p className="mt-auto px-3 pt-2 text-[11px] text-secondary">{watched}</p>
      <p data-testid="raccourcis" className="px-3 pb-2 text-[11px] text-secondary">{help}</p>
    </div>
  )
}
