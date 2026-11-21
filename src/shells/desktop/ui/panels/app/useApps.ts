import { useCallback, useSyncExternalStore } from 'react'
import { clientHas } from '@client/connections'
import { acquireApps, acquireImports, peekApps, peekImports, type MirrorHandle } from '@panels/app/client'
import type { AppEntry, PendingImport } from '@panels/app/contract'

export type ReadyApp = Extract<AppEntry, { status: 'ready' }>

function useMirror<T>(workspaceId: string | null | undefined, acquire: (id: string) => MirrorHandle<T>, peek: (id: string) => T[] | null): T[] | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!workspaceId) return () => {}
    const held = acquire(workspaceId)
    const off = held.subscribe(listener)
    return () => { off(); held.release() }
  }, [workspaceId, acquire])
  return useSyncExternalStore(subscribe, () => (workspaceId ? peek(workspaceId) : null))
}

/** The custom panels list of a workspace, mirrored from its runtime (null until it arrives). */
export const useApps = (workspaceId: string | null | undefined): AppEntry[] | null => useMirror(workspaceId, acquireApps, peekApps)

/** The imports of a workspace waiting for a human's click (`apps.watchImports`). */
export const useImports = (workspaceId: string | null | undefined): PendingImport[] => useMirror(workspaceId, acquireImports, peekImports) ?? []

/** The panels a person can open from a menu: the ready ones, on a client that
 *  can show a webview. A workspace that is not trusted lists only blocked folders. */
export function useReadyApps(workspaceId: string | null | undefined): ReadyApp[] {
  const list = useApps(workspaceId)
  if (!clientHas('webview')) return []
  return (list ?? []).filter((entry): entry is ReadyApp => entry.status === 'ready')
}
