import { useCallback, useSyncExternalStore } from 'react'
import { clientHas } from '@client/connections'
import { acquireApps, peekApps } from '@panels/app/client'
import type { AppEntry } from '@panels/app/contract'

export type ReadyApp = Extract<AppEntry, { status: 'ready' }>

/** The custom panels list of a workspace, mirrored from its runtime (null until it arrives). */
export function useApps(workspaceId: string | null | undefined): AppEntry[] | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!workspaceId) return () => {}
    const held = acquireApps(workspaceId)
    const off = held.subscribe(listener)
    return () => { off(); held.release() }
  }, [workspaceId])
  return useSyncExternalStore(subscribe, () => (workspaceId ? peekApps(workspaceId) : null))
}

/** The panels a person can open from a menu: the ready ones, on a client that
 *  can show a webview. A workspace that is not trusted lists only blocked folders. */
export function useReadyApps(workspaceId: string | null | undefined): ReadyApp[] {
  const list = useApps(workspaceId)
  if (!clientHas('webview')) return []
  return (list ?? []).filter((entry): entry is ReadyApp => entry.status === 'ready')
}
