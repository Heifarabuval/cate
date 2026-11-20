// Webview wiring (the `webview` and `pageDriver` features): each connected
// workspace's network policy is prepared in main (native networking or its
// protected loopback proxy) before any of its webviews mounts; views use that
// partition; and page operations the runtime sends to this client run on its
// mounted pages.

import { useSyncExternalStore } from 'react'
import { eachConnection, type WorkspaceConnections } from '@client/connections'
import { installBrowserPageBridge, installBrowserPartitions } from '@services/browser/desktop/renderer'
import { installAppPartitions } from '@panels/app/desktop'
import type { BrowserPageBridge } from '@services/browser/contract'
import { createLogger } from '@kernel/log/contract'
import type { DesktopApi } from '../contract'

const log = createLogger('webviews')

export interface WebviewPartitions {
  /** The prepared partition of an open workspace, or null until it is ready. */
  partition(workspaceId: string): string | null
  /** The prepared partition of a custom panel of an open workspace, or null. */
  appPartition(workspaceId: string, appId: string): string | null
  /** Prepares a custom panel's partition once its workspace's is ready. */
  prepareApp(workspaceId: string, appId: string): void
  /** Workspaces whose webviews may mount now. */
  ready(): readonly string[]
  /** The open workspace a prepared partition's runtime belongs to. */
  workspaceOf(runtimeId: string): string | null
  subscribe(listener: () => void): () => void
  dispose(): void
}

/** Prepares a partition for each connection once it first connects. */
export function prepareWebviewPartitions(api: DesktopApi, connections: WorkspaceConnections): WebviewPartitions {
  const partitions = new Map<string, string>()
  const runtimes = new Map<string, string>()
  // Custom panels: what the workspace's connection says, the partitions asked for, and the ones prepared.
  const workspaces = new Map<string, { runtimeId: string; reachesClientNetwork: boolean }>()
  const wanted = new Set<string>()
  const started = new Set<string>()
  const apps = new Map<string, string>()
  const appKey = (workspaceId: string, appId: string) => `${workspaceId}\0${appId}`
  const startApp = (workspaceId: string, appId: string) => {
    const key = appKey(workspaceId, appId)
    const info = workspaces.get(workspaceId)
    if (!info || started.has(key)) return
    started.add(key)
    api.web.appPartitionFor({ runtimeId: info.runtimeId, appId, reachesClientNetwork: info.reachesClientNetwork }).then(
      (partition) => { if (started.has(key)) { apps.set(key, partition); changed() } },
      (err: unknown) => { started.delete(key); log.warn('no partition for custom panel %s: %s', appId, err) },
    )
  }
  const listeners = new Set<() => void>()
  let ready: readonly string[] = []
  const changed = () => {
    ready = [...partitions.keys()]
    for (const listener of [...listeners]) listener()
  }

  const stop = eachConnection(connections, (connection) => {
    let runtimeId: string | null = null
    let closed = false
    let preparing = false
    const prepare = () => {
      if (preparing || runtimeId || connection.state.kind !== 'connected') return
      preparing = true
      connection.runtime.workspace.info()
        .then(async (info) => {
          const partition = await api.web.partitionFor({ runtimeId: info.runtimeId, reachesClientNetwork: connection.reachesClientNetwork })
          if (closed) return
          runtimeId = info.runtimeId
          runtimes.set(info.runtimeId, connection.workspaceId)
          partitions.set(connection.workspaceId, partition)
          workspaces.set(connection.workspaceId, { runtimeId: info.runtimeId, reachesClientNetwork: connection.reachesClientNetwork })
          for (const key of wanted) {
            const [workspaceId, appId] = key.split('\0')
            if (workspaceId === connection.workspaceId) startApp(workspaceId, appId)
          }
          changed()
        })
        .catch((err: unknown) => log.warn('no browser partition for %s: %s', connection.workspaceId, err))
        .finally(() => { preparing = false })
    }
    const off = connection.subscribe(prepare)
    prepare()
    return () => {
      closed = true
      off()
      workspaces.delete(connection.workspaceId)
      for (const key of [...started, ...apps.keys()]) if (key.startsWith(`${connection.workspaceId}\0`)) { started.delete(key); apps.delete(key) }
      if (partitions.delete(connection.workspaceId)) changed()
      if (runtimeId) {
        if (runtimes.get(runtimeId) === connection.workspaceId) runtimes.delete(runtimeId)
        void api.web.release({ runtimeId }).catch(() => {})
      }
    }
  })

  return {
    partition: (workspaceId) => partitions.get(workspaceId) ?? null,
    appPartition: (workspaceId, appId) => apps.get(appKey(workspaceId, appId)) ?? null,
    prepareApp(workspaceId, appId) {
      wanted.add(appKey(workspaceId, appId))
      startApp(workspaceId, appId)
    },
    ready: () => ready,
    workspaceOf: (runtimeId) => runtimes.get(runtimeId) ?? null,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      stop()
      listeners.clear()
    },
  }
}

export function useWebviewReadyWorkspaces(partitions: WebviewPartitions): readonly string[] {
  return useSyncExternalStore(partitions.subscribe, partitions.ready)
}

/** Browser partitions and the page bridge. */
export function installWebviewHosts(api: DesktopApi, partitions: WebviewPartitions, bridge: BrowserPageBridge | undefined): () => void {
  // Browser views wait for their partition (a reconnect or a re-run boot
  // can briefly leave a mounted view without one).
  installBrowserPartitions({
    partition: (workspaceId) => partitions.partition(workspaceId),
    subscribe: partitions.subscribe,
    agentPartition: (partition, panelId) => api.web.agentPartition({ partition, panelId }),
    grantSignIn: (partition, domain) => api.web.grantSignIn({ partition, domain }),
    releaseAgentPartition: (partition) => api.web.releaseAgentPartition({ partition }),
  })
  installAppPartitions({ partition: partitions.appPartition, prepare: partitions.prepareApp, subscribe: partitions.subscribe })
  installBrowserPageBridge(bridge ?? null)
  return () => {
    installBrowserPartitions(null)
    installAppPartitions(null)
    installBrowserPageBridge(null)
  }
}
