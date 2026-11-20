// The app panel's session channel: what a view renders (spec 008 P1). JSON
// only: `null` clears a value.

import type { FolderChanges } from './grant'

/** `needs-grant`: asks the user before anything runs. `running`: the page is
 *  served at `url`. `missing`: the folder is gone, the record stays.
 *  `error`: the manifest or page cannot load. `blocked`: workspace not trusted. */
export type AppState = 'needs-grant' | 'running' | 'missing' | 'error' | 'blocked'

export type AppSnapshot = {
  appId: string
  /** The manifest's name; null while the folder cannot be read. */
  name: string | null
  state: AppState
  /** The page, served by the runtime; set while `running`. */
  url: string | null
  /** One sentence the view shows for `needs-grant` (what the panel may do). */
  sentence: string | null
  /** The fingerprint of the card shown while `needs-grant` (the manifest's, the folder's for an
   *  installed panel): the grant op must echo it. */
  fingerprint: string | null
  /** Why the panel is not running (`missing`, `error`, `blocked`). */
  message: string | null
  /** An installed panel back in `needs-grant`: the files changed since the accepted ones. */
  changes: FolderChanges | null
  /** Counts page changes: a view reloads its webview when it moves. */
  reload: number
}
