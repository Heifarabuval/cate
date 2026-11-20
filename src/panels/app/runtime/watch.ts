// The real folder watcher behind the scanner: @parcel/watcher, loaded on
// first use (the daemon bundle keeps it out of its startup path).

import type { FsEvent } from './scan'

export async function watchFolder(dir: string, onEvents: (events: FsEvent[]) => void): Promise<() => Promise<void>> {
  const { default: watcher } = await import('@parcel/watcher')
  const subscription = await watcher.subscribe(dir, (error, events) => {
    if (!error) onEvents(events.map(({ path, type }) => ({ path, type })))
  })
  return () =>
    subscription.unsubscribe().catch((error: unknown) => {
      if (!folderGone(error)) throw error
    })
}

// A folder removed under the watcher has nothing left to release: the unwatch fails with ENOENT, or
// with "Unable to remove watcher: Invalid argument" (inotify: EINVAL). Any other failure is real.
function folderGone(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  return code === 'ENOENT' || (typeof message === 'string' && message.startsWith('Unable to remove watcher'))
}
