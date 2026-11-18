import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const app = vi.hoisted(() => {
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events')
  return Object.assign(new Emitter(), { quit: vi.fn(), exit: vi.fn() })
})
vi.mock('electron', () => ({ app, dialog: { showMessageBox: vi.fn() } }))

import { formatLogMessage, installLogSink } from '@kernel/log/contract'
import { createQuitController, decideQuitPrompt, QUIT_CLEANUP_TIMEOUT_MS, QUIT_EXIT_TIMEOUT_MS } from './lifecycle'
import { createAutoUpdater } from './updater/autoUpdater'

const quitAttempt = () => {
  const event = { preventDefault: vi.fn() }
  app.emit('before-quit', event)
  return event
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('decideQuitPrompt', () => {
  it('quits right away without blockers or the warn setting', () => {
    expect(decideQuitPrompt({ warnBeforeQuit: false, blockers: [] })).toBeNull()
    expect(decideQuitPrompt({ warnBeforeQuit: true, blockers: [] })).toEqual({ message: 'Quit Cate?' })
  })

  it('names client-local work in progress', () => {
    expect(decideQuitPrompt({ warnBeforeQuit: false, blockers: ['Importing 3 files'] })?.message).toBe('Importing 3 files is still in progress. Quit anyway?')
    expect(decideQuitPrompt({ warnBeforeQuit: false, blockers: ['a', 'b'] })?.message).toBe('2 tasks are still in progress. Quit anyway?')
  })
})

describe('quit controller', () => {
  let journal: string[] = []
  beforeEach(() => {
    app.removeAllListeners()
    app.quit.mockClear()
    app.exit.mockClear()
    journal = []
    installLogSink((record) => { if (record.scope === 'lifecycle') journal.push(`${record.level} ${formatLogMessage(record.message, record.args)}`) })
  })
  afterEach(() => {
    installLogSink(null)
    vi.useRealTimers()
  })

  it('quits after a named delay when cleanup never returns, and logs each step', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const beforeExit = vi.fn(() => new Promise<void>(() => {}))
    const quit = createQuitController({ warnBeforeQuit: () => false, blockers: () => [], parentWindow: () => undefined, beforeExit })
    quit.install()
    quitAttempt()
    await vi.advanceTimersByTimeAsync(QUIT_CLEANUP_TIMEOUT_MS - 1)
    expect(app.quit).not.toHaveBeenCalled()
    // A second Cmd+Q while the first is pending is ignored, but says so.
    quitAttempt()
    await vi.advanceTimersByTimeAsync(1)
    expect(quit.committed()).toBe(true)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(journal).toEqual([
      'info quit requested (warn=false, blockers=0)',
      'info quit cleanup started',
      'info quit already in progress, ignored',
      `warn quit cleanup timed out after ${QUIT_CLEANUP_TIMEOUT_MS} ms, quitting anyway`,
      'info quit committed',
    ])
  })

  it('logs the confirmation and its answer', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 1 }))
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => [], parentWindow: () => undefined, beforeExit: async () => {}, showMessageBox })
    quit.install()
    quitAttempt()
    await flush()
    expect(journal).toEqual([
      'info quit requested (warn=true, blockers=0)',
      'info quit confirmation shown: Quit Cate?',
      'info quit cancelled by the user',
    ])
  })

  it('a second Cmd+Q confirms a confirmation that never answers', async () => {
    const showMessageBox = vi.fn(() => new Promise<{ response: number }>(() => {}))
    const beforeExit = vi.fn(async () => {})
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => [], parentWindow: () => undefined, beforeExit, showMessageBox })
    quit.install()
    quitAttempt()
    await flush()
    expect(app.quit).not.toHaveBeenCalled()
    quitAttempt()
    await flush()
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(beforeExit).toHaveBeenCalledOnce()
    expect(quit.committed()).toBe(true)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(journal).toEqual([
      'info quit requested (warn=true, blockers=0)',
      'info quit confirmation shown: Quit Cate?',
      'info quit confirmed by a second Cmd+Q',
      'info quit cleanup started',
      'info quit committed',
    ])
  })

  it('a second Cmd+Q leaves the in-progress tasks dialog open and says so', async () => {
    const showMessageBox = vi.fn(() => new Promise<{ response: number }>(() => {}))
    const beforeExit = vi.fn(async () => {})
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => ['Importing 3 files'], parentWindow: () => undefined, beforeExit, showMessageBox })
    quit.install()
    quitAttempt()
    await flush()
    quitAttempt()
    await flush()
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(beforeExit).not.toHaveBeenCalled()
    expect(quit.committed()).toBe(false)
    expect(app.quit).not.toHaveBeenCalled()
    expect(journal).toEqual([
      'info quit requested (warn=true, blockers=1)',
      'info quit confirmation shown: Importing 3 files is still in progress. Quit anyway?',
      'info second quit ignored: the tasks dialog needs an explicit answer',
    ])
  })

  it('quits anyway when beforeExit throws before returning a promise', async () => {
    const beforeExit = vi.fn((): Promise<void> => { throw new Error('sync boom') })
    const quit = createQuitController({ warnBeforeQuit: () => false, blockers: () => [], parentWindow: () => undefined, beforeExit })
    quit.install()
    quitAttempt()
    await flush()
    expect(quit.committed()).toBe(true)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(journal[2]).toMatch(/^warn quit cleanup failed: /)
  })

  it('exits the process when a committed quit does not finish in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const quit = createQuitController({ warnBeforeQuit: () => false, blockers: () => [], parentWindow: () => undefined, beforeExit: async () => {} })
    quit.install()
    quitAttempt()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(QUIT_EXIT_TIMEOUT_MS)
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(journal.at(-1)).toBe(`warn quit still pending after ${QUIT_EXIT_TIMEOUT_MS} ms, exiting`)
  })

  it('cleans up, then commits the quit', async () => {
    const beforeExit = vi.fn(async () => {})
    const quit = createQuitController({ warnBeforeQuit: () => false, blockers: () => [], parentWindow: () => undefined, beforeExit })
    quit.install()
    expect(quitAttempt().preventDefault).toHaveBeenCalled()
    await flush()
    expect(beforeExit).toHaveBeenCalledOnce()
    expect(quit.committed()).toBe(true)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(quitAttempt().preventDefault).not.toHaveBeenCalled()
  })

  it('a cancelled confirmation leaves the app running; a confirmed one quits', async () => {
    let answer = 1
    const showMessageBox = vi.fn(async () => ({ response: answer }))
    const beforeExit = vi.fn(async () => {})
    const quit = createQuitController({ warnBeforeQuit: () => false, blockers: () => ['Importing files'], parentWindow: () => undefined, beforeExit, showMessageBox })
    quit.install()
    quitAttempt()
    await flush()
    expect(app.quit).not.toHaveBeenCalled()
    expect(beforeExit).not.toHaveBeenCalled()
    answer = 0
    quitAttempt()
    await flush()
    expect(app.quit).toHaveBeenCalledOnce()
    quitAttempt()
    await flush()
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(beforeExit).toHaveBeenCalledOnce()
    expect(quit.committed()).toBe(true)
  })

  it('flushes before an update installer can close windows, without another generic quit warning', async () => {
    let finishCleanup!: () => void
    const beforeExit = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve }))
    const showMessageBox = vi.fn()
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => [], parentWindow: () => undefined, beforeExit, showMessageBox })
    quit.install()
    const install = vi.fn(() => {
      expect(quit.committed()).toBe(true)
      expect(quitAttempt().preventDefault).not.toHaveBeenCalled()
    })
    const engine = Object.assign(new EventEmitter(), {
      autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false,
      forceDevUpdateConfig: false, disableDifferentialDownload: false,
      checkForUpdatesAndNotify: async () => ({}), checkForUpdates: async () => ({}),
      quitAndInstall: install,
    })
    const updater = createAutoUpdater({
      updater: engine,
      app: { isPackaged: true, getVersion: () => '2.0.3', moveToApplicationsFolder: () => true },
      state: { get: () => ({ pendingVersion: null, attempts: 0 }), set: () => {} },
      track: () => {}, broadcast: () => {}, showMessageBox: async () => ({ response: 1 }), openExternal: () => {},
      canSelfUpdate: () => true, betaUpdatesEnabled: () => false,
      restartForUpdate: quit.restartForUpdate, cancelUpdateRestart: quit.cancelUpdateRestart,
      setTimeout: () => {}, setInterval: () => {},
    })
    updater.start()
    engine.emit('update-downloaded', { version: '2.0.4' })
    const requested = updater.installNow()
    expect(beforeExit).toHaveBeenCalledOnce()
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    // Another window or a normal quit cannot race the pending cleanup.
    await expect(updater.installNow()).resolves.toBe(false)
    quitAttempt()
    expect(beforeExit).toHaveBeenCalledOnce()
    finishCleanup()
    await expect(requested).resolves.toBe(true)
    expect(install).not.toHaveBeenCalled()
    await flush()
    expect(install).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledWith(false, true)
  })

  it('can cancel an update restart for client-local work, then retry', async () => {
    let answer = 1
    const beforeExit = vi.fn(async () => {})
    const showMessageBox = vi.fn(async () => ({ response: answer }))
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => ['Importing files'], parentWindow: () => undefined, beforeExit, showMessageBox })
    const install = vi.fn()
    await expect(quit.restartForUpdate(install)).resolves.toBe(false)
    expect(quit.committed()).toBe(false)
    expect(beforeExit).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    answer = 0
    await expect(quit.restartForUpdate(install)).resolves.toBe(true)
    await flush()
    expect(beforeExit).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledOnce()
  })

  it('restores normal quit checks if the installer fails', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 1 }))
    const quit = createQuitController({ warnBeforeQuit: () => true, blockers: () => [], parentWindow: () => undefined, beforeExit: async () => {}, showMessageBox })
    quit.install()
    await expect(quit.restartForUpdate(() => quit.cancelUpdateRestart())).resolves.toBe(true)
    await flush()
    expect(quit.committed()).toBe(false)
    expect(quitAttempt().preventDefault).toHaveBeenCalled()
    await flush()
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
  })
})

