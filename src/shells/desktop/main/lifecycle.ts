// Quitting closes windows and connections only; every runtime then follows
// its `keepRunningWhile` (architecture 15). So the only quit blockers are
// client-local work (a file drop still importing), which renderers report, and
// the "Warn before quit" setting.

import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { createLogger } from '@kernel/log/contract'

const log = createLogger('lifecycle')

/** How long quit cleanup may take before the app quits without it. */
export const QUIT_CLEANUP_TIMEOUT_MS = 5_000
/** How long a committed quit may take (windows closing) before the process exits. */
export const QUIT_EXIT_TIMEOUT_MS = 10_000

/** Resolves when `work` settles or after `ms`, whichever comes first; true on timeout. */
function settleWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), ms) })
  const done = work.then(() => false, (error) => {
    log.warn('quit cleanup failed: %O', error)
    return false
  })
  return Promise.race([done, timeout]).finally(() => clearTimeout(timer))
}

/** The confirmation to show before quitting, or null to quit right away. */
export function decideQuitPrompt(options: { warnBeforeQuit: boolean; blockers: readonly string[] }): { message: string; detail?: string } | null {
  const { blockers } = options
  if (blockers.length > 0) {
    return {
      message: blockers.length === 1 ? `${blockers[0]} is still in progress. Quit anyway?` : `${blockers.length} tasks are still in progress. Quit anyway?`,
      detail: blockers.length > 1 ? blockers.join('\n') : 'It will be stopped. Workspaces keep running.',
    }
  }
  return options.warnBeforeQuit ? { message: 'Quit Cate?' } : null
}

export interface QuitDeps {
  warnBeforeQuit(): boolean
  blockers(): string[]
  parentWindow(): BrowserWindow | undefined
  /** Work before the app goes: flush device files and browser storage, close proxies. */
  beforeExit(): Promise<void>
  showMessageBox?(parent: BrowserWindow | undefined, options: MessageBoxOptions): Promise<{ response: number }>
}

export interface QuitController {
  committed(): boolean
  install(): void
  /** An explicit restart skips the generic quit warning, but still confirms
   *  client-local blockers and flushes the client before invoking an installer. */
  restartForUpdate(install: () => void): Promise<boolean>
  /** An installer error leaves the client running with normal quit checks. */
  cancelUpdateRestart(): void
}

export function createQuitController(deps: QuitDeps): QuitController {
  let committed = false
  let finishing = false
  let updateRestart = false
  const show = deps.showMessageBox ?? ((parent, options) => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)))

  const finish = async (action: () => void, warn: boolean): Promise<boolean> => {
    if (finishing || committed) {
      log.info('quit already in progress, ignored')
      return false
    }
    finishing = true
    try {
      const warnBeforeQuit = warn && deps.warnBeforeQuit()
      const blockers = deps.blockers()
      log.info('quit requested (warn=%s, blockers=%d)', warnBeforeQuit, blockers.length)
      const prompt = decideQuitPrompt({ warnBeforeQuit, blockers })
      if (prompt) {
        log.info('quit confirmation shown: %s', prompt.message)
        const { response } = await show(deps.parentWindow(), {
          type: 'warning',
          message: prompt.message,
          detail: prompt.detail,
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        if (response !== 0) {
          log.info('quit cancelled by the user')
          return false
        }
      }
      log.info('quit cleanup started')
      // A cleanup that never returns (a flush stuck in swap) must not keep the app open.
      if (await settleWithin(deps.beforeExit(), QUIT_CLEANUP_TIMEOUT_MS)) {
        log.warn('quit cleanup timed out after %d ms, quitting anyway', QUIT_CLEANUP_TIMEOUT_MS)
      }
      committed = true
      log.info('quit committed')
      action()
      return true
    } finally {
      finishing = false
    }
  }

  const install = () => {
    app.on('before-quit', (event) => {
      if (committed) return
      event.preventDefault()
      void finish(() => {
        app.quit()
        // Closing windows waits on their renderers; a hung one would hold the quit forever.
        setTimeout(() => {
          log.warn('quit still pending after %d ms, exiting', QUIT_EXIT_TIMEOUT_MS)
          app.exit(0)
        }, QUIT_EXIT_TIMEOUT_MS).unref()
      }, true).catch((error) => log.warn('quit failed: %O', error))
    })
  }

  return {
    committed: () => committed,
    install,
    // Reply to the renderer before the installer can close its window.
    restartForUpdate: (apply) => finish(() => {
      updateRestart = true
      setImmediate(() => { if (updateRestart) apply() })
    }, false),
    cancelUpdateRestart() {
      if (!updateRestart) return
      updateRestart = false
      committed = false
    },
  }
}
