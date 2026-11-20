// Desktop side of the app panel, in the renderer: the partition of a custom
// panel's webview. The shell names it (it knows the runtime behind a workspace
// and routes the partition through that workspace's loopback proxy), and the
// view waits for it, like the browser panel does for its workspace partition.

export interface AppPartitionSource {
  /** The prepared partition of panel `appId` in a workspace, or null until it is ready. */
  partition(workspaceId: string, appId: string): string | null
  /** Asks the shell to prepare it (idempotent, waits for the workspace). */
  prepare(workspaceId: string, appId: string): void
  subscribe(listener: () => void): () => void
}

let source: AppPartitionSource | null = null
const listeners = new Set<() => void>()
let stopSource: (() => void) | null = null

export function installAppPartitions(next: AppPartitionSource | null): void {
  stopSource?.()
  source = next
  const notify = () => { for (const listener of [...listeners]) listener() }
  stopSource = next ? next.subscribe(notify) : null
  notify()
}

export const appPartition = (workspaceId: string, appId: string): string | null => source?.partition(workspaceId, appId) ?? null

export const prepareAppPartition = (workspaceId: string, appId: string): void => source?.prepare(workspaceId, appId)

export function subscribeAppPartitions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
