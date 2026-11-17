// Done-when conditions (`cate agent start --done-when`): a shell command,
// set at start, that says whether the agent's task is finished. It runs in
// the agent's checkout after each of its turns, one at a time per panel.
// Exit 0 closes the panel (its process with it) and tells the caller; a
// non-zero exit changes nothing; a timeout or an error is kept as the last
// result, which `cate agent list` shows. Conditions persist in
// `agents/done-when.json` (written at start, dropped with the panel) and are
// checked once at runtime start: an agent that finished while the runtime was
// down sends no turn-end.

import { spawn, type ChildProcess } from 'node:child_process'
import { createJsonStateFile } from '@kernel/state/node'

export const DONE_WHEN_TIMEOUT_MS = 60_000

/** One run of the command: its exit code, or why there is none. */
export type DoneWhenRun = { exitCode: number } | { timedOut: true } | { error: string }

export type DoneWhenResult =
  | { at: number; outcome: 'notDone'; exitCode: number }
  | { at: number; outcome: 'timeout' | 'error'; reason: string }

/** What `cate agent list` shows of a panel's condition. */
export interface DoneWhenState {
  command: string
  checking: boolean
  last?: DoneWhenResult
}

export interface DoneWhenDeps {
  run(command: string, cwd: string): Promise<DoneWhenRun>
  /** The panel's title, or undefined once it is gone. */
  panelTitle(panelId: string): string | undefined
  /** Removes the panel from the runtime side, dropping its work. */
  close(panelId: string): void
  /** Tells the panel that started the agent (none for a client). */
  notify(callerPanelId: string | undefined, done: { panelId: string; title: string; command: string }): void
  now?(): number
  /** `agents/done-when.json`; without it conditions live in memory. */
  file?: string
}

/** A condition as set at start, and as `done-when.json` keeps it per panel. */
export interface DoneWhenCondition { command: string; cwd: string; callerPanelId?: string }

export interface DoneWhen {
  /** Sets (null: drops) the panel's condition. */
  watch(panelId: string, condition: DoneWhenCondition | null): void
  state(panelId: string): DoneWhenState | undefined
  /** A turn ended in the panel: runs its condition unless one is running. */
  check(panelId: string): Promise<void>
  /** Drops the conditions of panels that are gone. */
  prune(): void
  /** Runtime start: prunes, then checks every condition read back once. */
  resume(): Promise<void>
  dispose(): void
}

function normalizeConditions(parsed: unknown): Record<string, DoneWhenCondition> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, DoneWhenCondition> = {}
  for (const [panelId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const c = value as Partial<DoneWhenCondition> | null
    if (!c || typeof c.command !== 'string' || !c.command.trim() || typeof c.cwd !== 'string') continue
    out[panelId] = { command: c.command, cwd: c.cwd, ...(typeof c.callerPanelId === 'string' ? { callerPanelId: c.callerPanelId } : {}) }
  }
  return out
}

interface Watched extends DoneWhenCondition {
  checking: boolean
  /** A turn ended while the check ran: it judged the state before that turn. */
  recheck?: boolean
  last?: DoneWhenResult
}

export function createDoneWhen(deps: DoneWhenDeps): DoneWhen {
  const watched = new Map<string, Watched>()
  const now = deps.now ?? Date.now
  const file = deps.file ? createJsonStateFile<Record<string, DoneWhenCondition>>({ file: deps.file, defaults: {}, normalize: normalizeConditions, mode: 0o600 }) : null
  for (const [panelId, condition] of Object.entries(file?.load() ?? {})) watched.set(panelId, { ...condition, checking: false })
  const save = (): void => {
    file?.set(Object.fromEntries([...watched].map(([panelId, { command, cwd, callerPanelId }]) =>
      [panelId, { command, cwd, ...(callerPanelId ? { callerPanelId } : {}) }])))
  }
  const drop = (panelId: string): void => {
    if (watched.delete(panelId)) save()
  }
  const prune = (): void => {
    for (const panelId of [...watched.keys()]) if (deps.panelTitle(panelId) === undefined) drop(panelId)
  }

  return {
    watch(panelId, condition) {
      if (condition) { watched.set(panelId, { ...condition, checking: false }); save() }
      else drop(panelId)
    },

    state(panelId) {
      const w = watched.get(panelId)
      return w ? { command: w.command, checking: w.checking, ...(w.last ? { last: w.last } : {}) } : undefined
    },

    check,
    prune,
    async resume() {
      prune()
      await Promise.all([...watched.keys()].map(check))
    },
    dispose() { file?.dispose() },
  }

  /** One run, then one more if a turn ended during it (the flag is taken
   *  before the rerun, so only later turn-ends set it again). */
  async function check(panelId: string): Promise<void> {
    const w = watched.get(panelId)
    if (!w) return
    if (w.checking) { w.recheck = true; return }
    await runOnce(panelId, w)
    if (w.recheck && watched.get(panelId) === w) {
      w.recheck = false
      await check(panelId)
    }
  }

  async function runOnce(panelId: string, w: Watched): Promise<void> {
    if (deps.panelTitle(panelId) === undefined) { drop(panelId); return }
    w.checking = true
    let run: DoneWhenRun
    try {
      run = await deps.run(w.command, w.cwd)
    } catch (error) {
      run = { error: error instanceof Error ? error.message : String(error) }
    }
    w.checking = false
    // Closed (or re-watched by a new start) while the command ran.
    if (watched.get(panelId) !== w) return
    const title = deps.panelTitle(panelId)
    if (title === undefined) { drop(panelId); return }
    if ('timedOut' in run) { w.last = { at: now(), outcome: 'timeout', reason: `timed out after ${DONE_WHEN_TIMEOUT_MS / 1_000} s` }; return }
    if ('error' in run) { w.last = { at: now(), outcome: 'error', reason: run.error }; return }
    if (run.exitCode !== 0) { w.last = { at: now(), outcome: 'notDone', exitCode: run.exitCode }; return }
    try {
      deps.close(panelId)
    } catch (error) {
      w.last = { at: now(), outcome: 'error', reason: `exited 0 but the panel could not close: ${error instanceof Error ? error.message : String(error)}` }
      return
    }
    drop(panelId)
    deps.notify(w.callerPanelId, { panelId, title, command: w.command })
  }
}

/** Runs `command` in a shell in `cwd`; on timeout kills its whole process
 *  group, so a pipeline's children go too. */
export function runDoneWhenCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = DONE_WHEN_TIMEOUT_MS): Promise<DoneWhenRun> {
  return new Promise((resolve) => {
    let child: ChildProcess
    const group = process.platform !== 'win32'
    try {
      child = spawn(command, { cwd, env, shell: true, stdio: 'ignore', detached: group })
    } catch (error) {
      resolve({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    const timer = setTimeout(() => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch { /* already gone */ }
      resolve({ timedOut: true })
    }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); resolve({ error: error.message }) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve(code === null ? { error: `killed by ${signal ?? 'a signal'}` } : { exitCode: code })
    })
  })
}
