import React, { useCallback } from 'react'
import { LoadingState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import type { ReviewOp, ReviewSnapshot } from '@panels/review/contract'
import AgentChangesView from './AgentChangesView'
import PullRequestView from './PullRequestView'

export default function ReviewView({ workspaceId, panelId, snapshot, send, visible }: PanelViewProps<ReviewSnapshot, ReviewOp>) {
  const sendOp = useCallback((op: ReviewOp) => send(op), [send])
  if (!snapshot) return <LoadingState label="Loading review panel" className="h-full p-4 text-xs" />
  if (snapshot.pr) return <PullRequestView workspaceId={workspaceId} panelId={panelId} snapshot={snapshot} pr={snapshot.pr} send={sendOp} visible={visible} />
  return <AgentChangesView workspaceId={workspaceId} panelId={panelId} snapshot={snapshot} send={sendOp} />
}
