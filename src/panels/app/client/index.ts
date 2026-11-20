// The client's mirror of the custom panels list (`apps.watch`): one stream per
// workspace, shared by every consumer, closed when the last one releases it.
// No React: a shell wraps `acquireApps` in its own hook.

import { subscribeRuntimes, tryRuntimeFor } from '@kernel/rpc/client'
import type { RuntimeProxy } from '@kernel/rpc/contract'
import type { AppEntry } from '../contract'

interface Entry {
  refs: number
  list: AppEntry[] | null
  runtime: RuntimeProxy | null
  stop: (() => void) | null
  listeners: Set<() => void>
  stopRuntimes: () => void
}

const entries = new Map<string, Entry>()

export interface AppsHandle {
  /** The list, or null until the runtime sent it. */
  getSnapshot(): AppEntry[] | null
  subscribe(listener: () => void): () => void
  /** Drops this consumer; the last release closes the stream. */
  release(): void
}

const notify = (entry: Entry) => { for (const listener of [...entry.listeners]) listener() }

function connect(workspaceId: string, entry: Entry): void {
  const runtime = tryRuntimeFor(workspaceId)
  if (runtime === entry.runtime && (entry.stop || !runtime)) return
  entry.stop?.()
  entry.stop = null
  entry.runtime = runtime
  const had = entry.list !== null
  entry.list = null
  if (runtime) {
    const subscription = runtime.apps.watch(undefined, { resume: true })
    const off = subscription.onEvent((list) => { entry.list = list; notify(entry) })
    entry.stop = () => { off(); subscription.cancel() }
  }
  if (had) notify(entry)
}

export function acquireApps(workspaceId: string): AppsHandle {
  let entry = entries.get(workspaceId)
  if (!entry) {
    const created: Entry = { refs: 0, list: null, runtime: null, stop: null, listeners: new Set(), stopRuntimes: () => {} }
    entries.set(workspaceId, created)
    created.stopRuntimes = subscribeRuntimes(() => connect(workspaceId, created))
    connect(workspaceId, created)
    entry = created
  }
  entry.refs++
  const own = entry
  let released = false
  return {
    getSnapshot: () => own.list,
    subscribe(listener) {
      own.listeners.add(listener)
      return () => { own.listeners.delete(listener) }
    },
    release() {
      if (released) return
      released = true
      if (--own.refs > 0) return
      own.stopRuntimes()
      own.stop?.()
      own.listeners.clear()
      if (entries.get(workspaceId) === own) entries.delete(workspaceId)
    }
  }
}

/** The current list without taking a reference (null when nobody holds one). */
export function peekApps(workspaceId: string): AppEntry[] | null {
  return entries.get(workspaceId)?.list ?? null
}
