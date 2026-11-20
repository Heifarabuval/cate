import { useEffect, useRef, useSyncExternalStore } from 'react'
import { appPartition, prepareAppPartition, subscribeAppPartitions } from '@panels/app/desktop'
import { PanelCenteredState } from '../../kernel/interaction'

type Guest = HTMLElement & { reload(): void }

/** The page of a custom panel: a webview in its own partition, no popups. It
 *  mounts only for a running panel, so nothing of the page runs before the grant. */
export function AppWebview({ workspaceId, appId, url, reload }: { workspaceId: string; panelId: string; appId: string; url: string; reload: number }) {
  const partition = useSyncExternalStore(subscribeAppPartitions, () => appPartition(workspaceId, appId))
  const guest = useRef<Guest | null>(null)
  useEffect(() => { prepareAppPartition(workspaceId, appId) }, [workspaceId, appId])
  const first = useRef(reload)
  useEffect(() => {
    if (reload === first.current) return
    try { guest.current?.reload() } catch { /* not attached yet: the next load reads the current page */ }
  }, [reload])
  if (!partition) return <PanelCenteredState title="Chargement" />
  return (
    <webview
      ref={guest as never}
      src={url}
      partition={partition}
      className="absolute inset-0"
      style={{ width: '100%', height: '100%', backgroundColor: '#fff' }}
    />
  )
}
