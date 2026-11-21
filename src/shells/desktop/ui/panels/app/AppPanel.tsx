import { PanelCenteredState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import type { AppOp, AppSnapshot } from '@panels/app/contract'
import { AppsPage } from './AppsPage'
import { AppWebview } from './AppWebview'
import { GrantCard } from './GrantCard'

/** A custom panel in its frame: the name and origin are Cate's, the page below
 *  is the panel's. The page mounts only once the user allowed it. */
export default function AppPanel({ workspaceId, panelId, snapshot, send }: PanelViewProps<AppSnapshot, AppOp>) {
  if (!snapshot) return <PanelCenteredState title="Chargement" />
  if (!snapshot.appId) return <AppsPage workspaceId={workspaceId} />
  const frame = (body: React.ReactNode) => (
    <div className="flex h-full w-full flex-col bg-surface-4">
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-subtle px-2 text-[11px] text-muted">
        <span className="truncate">Panneau perso : {snapshot.appId}</span>
        {snapshot.name && <span className="truncate text-secondary">{snapshot.name}</span>}
      </div>
      {snapshot.state === 'running' && snapshot.message && <div className="shrink-0 border-b border-subtle bg-surface-2 px-2 py-1 text-[11px] text-red-400">{snapshot.message}</div>}
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  )
  switch (snapshot.state) {
    case 'running':
      return frame(snapshot.url && <AppWebview workspaceId={workspaceId} panelId={panelId} appId={snapshot.appId} url={snapshot.url} reload={snapshot.reload} />)
    case 'needs-grant':
      return frame(<GrantCard name={snapshot.name} sentence={snapshot.sentence ?? ''} changes={snapshot.changes} onGrant={() => void send({ kind: 'grant', fingerprint: snapshot.fingerprint ?? '' })} onRefuse={() => void send({ kind: 'refuse' })} />)
    case 'missing':
      return frame(<PanelCenteredState title="Panneau perso introuvable" description={`Le dossier ${snapshot.appId} n’existe plus dans ~/.cate/panneaux/.`} />)
    case 'blocked':
      return frame(<PanelCenteredState title="Workspace non approuvé" description={snapshot.message ?? undefined} />)
    case 'error':
      return frame(<PanelCenteredState title="Panneau perso en erreur" description={snapshot.message ?? undefined} />)
  }
}
