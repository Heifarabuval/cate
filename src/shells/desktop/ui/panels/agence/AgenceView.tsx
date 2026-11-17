import { useState } from 'react'
import type { AgenceOp, AgenceOpResult, AgenceSnapshot } from '@panels/agence/contract'
import { InlineNotice, LoadingState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import DraftReader from './DraftReader'
import SuiviList from './SuiviList'

/** The agence panel: the project's follow-up, and the draft being read. */
export default function AgenceView({ workspaceId, panelId, snapshot, send }: PanelViewProps<AgenceSnapshot, AgenceOp>) {
  const [reading, setReading] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const rebase = async (questionId: string) => {
    setRefusal(null)
    const result = await send({ kind: 'answer', questionId, choice: 'rebase' }) as AgenceOpResult
    if (!result.ok) setRefusal(result.message ?? result.error)
  }
  if (!snapshot) return <LoadingState label="Loading agence panel" className="h-full p-4 text-xs" />
  const draft = reading ? snapshot.drafts[reading] : undefined
  return (
    <div className="h-full min-w-0 overflow-auto bg-surface-1">
      {draft
        ? <DraftReader workspaceId={workspaceId} panelId={panelId} draft={draft} send={send} onBack={() => setReading(null)} />
        : snapshot.suivi
          ? (
            <>
              {refusal && <InlineNotice tone="error" className="mx-3 mt-3">{refusal}</InlineNotice>}
              <SuiviList suivi={snapshot.suivi} onRead={setReading} onRebase={(questionId) => void rebase(questionId)} />
            </>
          )
          : <div className="p-4 text-[12px] text-muted">Aucun suivi pour l&apos;instant.</div>}
    </div>
  )
}
