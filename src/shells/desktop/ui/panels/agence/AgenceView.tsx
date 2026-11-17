import { useState } from 'react'
import type { AgenceOp, AgenceSnapshot } from '@panels/agence/contract'
import { LoadingState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import DraftReader from './DraftReader'
import SuiviList from './SuiviList'

/** The agence panel: the project's follow-up, and the draft being read. */
export default function AgenceView({ workspaceId, panelId, snapshot, send }: PanelViewProps<AgenceSnapshot, AgenceOp>) {
  const [reading, setReading] = useState<string | null>(null)
  if (!snapshot) return <LoadingState label="Loading agence panel" className="h-full p-4 text-xs" />
  const draft = reading ? snapshot.drafts[reading] : undefined
  return (
    <div className="h-full min-w-0 overflow-auto bg-surface-1">
      {draft
        ? <DraftReader workspaceId={workspaceId} panelId={panelId} draft={draft} send={send} onBack={() => setReading(null)} />
        : snapshot.suivi
          ? <SuiviList suivi={snapshot.suivi} onRead={setReading} />
          : <div className="p-4 text-[12px] text-muted">Aucun suivi pour l&apos;instant.</div>}
    </div>
  )
}
