import { Suspense, useCallback, useMemo } from 'react'
import type { AgenceOp, AgenceSnapshot } from '@panels/agence/contract'
import type { TerminalOp, TerminalSnapshot } from '@panels/terminal/contract/types'
import { LoadingState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import { TerminalPane as TerminalView } from '../terminal'

/** The orchestrator's PTY as a terminal snapshot: the terminal view only needs
 *  its id and whether it runs. */
function terminalSnapshot(snapshot: AgenceSnapshot): TerminalSnapshot {
  return {
    ptyId: snapshot.ptyId,
    status: snapshot.orchestrator,
    title: 'Orchestrateur',
    cwd: null,
    activity: { type: 'idle' },
    exitCode: null,
    error: snapshot.orchestrator === 'failed' ? "L'orchestrateur n'a pas pu démarrer." : null,
  }
}

/** The conversation column: the terminal view on the orchestrator's PTY (the
 *  same xterm binding as a terminal panel), in this panel's name. Its retry is
 *  the panel's `orchestrator.restart`. */
export default function TerminalPane({ workspaceId, panelId, record, session, snapshot, send, visible, focused }: PanelViewProps<AgenceSnapshot, AgenceOp>) {
  const terminal = useMemo(() => (snapshot ? terminalSnapshot(snapshot) : null), [snapshot])
  const sendTerminalOp = useCallback(
    (op: TerminalOp) => (op.kind === 'restart' ? send({ kind: 'orchestrator.restart' }) : Promise.resolve(undefined)),
    [send],
  )
  return (
    <Suspense fallback={<LoadingState label="Loading terminal" className="h-full p-4 text-xs" />}>
      <TerminalView
        workspaceId={workspaceId}
        panelId={panelId}
        record={record}
        session={session as never}
        snapshot={terminal}
        send={sendTerminalOp}
        visible={visible}
        focused={focused}
      />
    </Suspense>
  )
}
