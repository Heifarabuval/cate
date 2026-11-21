// The client's mirrors of the custom panels list (`apps.watch`) and of the
// pending imports (`apps.watchImports`): one stream per workspace and kind,
// shared by every consumer, closed when the last one releases it.
// No React: a shell wraps `acquireApps` and `acquireImports` in its own hooks.

import { subscribeRuntimes, tryRuntimeFor } from '@kernel/rpc/client'
import type { RuntimeProxy } from '@kernel/rpc/contract'
import type { AppEntry, PendingImport } from '../contract'

type Stream = 'watch' | 'watchImports'

interface Entry {
  refs: number
  list: unknown[] | null
  runtime: RuntimeProxy | null
  stop: (() => void) | null
  listeners: Set<() => void>
  stopRuntimes: () => void
}

const entries = new Map<string, Entry>()
const keyOf = (stream: Stream, workspaceId: string) => `${stream}\0${workspaceId}`

export interface MirrorHandle<T> {
  /** The list, or null until the runtime sent it. */
  getSnapshot(): T[] | null
  subscribe(listener: () => void): () => void
  /** Drops this consumer; the last release closes the stream. */
  release(): void
}

const notify = (entry: Entry) => { for (const listener of [...entry.listeners]) listener() }

function connect(stream: Stream, workspaceId: string, entry: Entry): void {
  const runtime = tryRuntimeFor(workspaceId)
  if (runtime === entry.runtime && (entry.stop || !runtime)) return
  entry.stop?.()
  entry.stop = null
  entry.runtime = runtime
  const had = entry.list !== null
  entry.list = null
  if (runtime) {
    const subscription = runtime.apps[stream](undefined, { resume: true })
    const off = subscription.onEvent((list: unknown[]) => { entry.list = list; notify(entry) })
    entry.stop = () => { off(); subscription.cancel() }
  }
  if (had) notify(entry)
}

function acquire<T>(stream: Stream, workspaceId: string): MirrorHandle<T> {
  const key = keyOf(stream, workspaceId)
  let entry = entries.get(key)
  if (!entry) {
    const created: Entry = { refs: 0, list: null, runtime: null, stop: null, listeners: new Set(), stopRuntimes: () => {} }
    entries.set(key, created)
    created.stopRuntimes = subscribeRuntimes(() => connect(stream, workspaceId, created))
    connect(stream, workspaceId, created)
    entry = created
  }
  entry.refs++
  const own = entry
  let released = false
  return {
    getSnapshot: () => own.list as T[] | null,
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
      if (entries.get(key) === own) entries.delete(key)
    }
  }
}

export const acquireApps = (workspaceId: string): MirrorHandle<AppEntry> => acquire<AppEntry>('watch', workspaceId)
export const acquireImports = (workspaceId: string): MirrorHandle<PendingImport> => acquire<PendingImport>('watchImports', workspaceId)

/** The current list without taking a reference (null when nobody holds one). */
export const peekApps = (workspaceId: string): AppEntry[] | null => (entries.get(keyOf('watch', workspaceId))?.list as AppEntry[] | undefined) ?? null
export const peekImports = (workspaceId: string): PendingImport[] | null =>
  (entries.get(keyOf('watchImports', workspaceId))?.list as PendingImport[] | undefined) ?? null
