// The real folder watcher behind the scanner: @parcel/watcher, loaded on
// first use (the daemon bundle keeps it out of its startup path).

import type { FsEvent } from './scan'

export async function watchFolder(dir: string, onEvents: (events: FsEvent[]) => void): Promise<() => void> {
  const { default: watcher } = await import('@parcel/watcher')
  const subscription = await watcher.subscribe(dir, (error, events) => {
    if (!error) onEvents(events.map(({ path, type }) => ({ path, type })))
  })
  return () => { void subscription.unsubscribe() }
}
