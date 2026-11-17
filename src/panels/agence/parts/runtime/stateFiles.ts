// Reads the `agence` CLI's folder (`<root>/.cate/tmp/agence/`): its state and
// the text of the open drafts. Read only: the CLI is the one writer, it
// replaces files atomically, so a read sees a whole file. Changes come from
// `fs.watch`, with a poll as the safety net (a folder that appears later, a
// watch the OS dropped), so an update shows in about `pollMs` at worst.

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { AgenceState } from '../../contract/types'

export interface StateFilesRead {
  /** The last valid state; null when the file never existed or was never valid. */
  state: AgenceState | null
  /** Text of the drafts with statut `à valider` or `envoyer`, by id. */
  drafts: Record<string, string>
  /** Set while the state file is unreadable: `state` is then the previous one. */
  error: string | null
  /** ISO time the current state was read. */
  readAt: string | null
}

export interface StateFiles {
  read(): StateFilesRead
  dispose(): void
}

export interface StateFilesOptions {
  dir: string
  /** A different read than the last one. */
  onChange(read: StateFilesRead): void
  pollMs?: number
}

const OPEN_DRAFT = new Set(['à valider', 'envoyer'])
const SAFE_ID = /^[\w-]+$/

/** The defaults `load()` of agence.py gives a state missing some keys. */
function normalize(parsed: unknown): AgenceState {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state is not an object')
  const raw = parsed as Partial<AgenceState>
  if (!Array.isArray(raw.needs)) throw new Error('state has no needs list')
  return {
    repo: '', ghRepo: null, agentsActive: 0, port: null, panels: {}, titles: {}, drafts: [], questions: [],
    ...raw,
  } as AgenceState
}

const readText = (file: string): string | null => {
  try { return readFileSync(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function createStateFiles(options: StateFilesOptions): StateFiles {
  const { dir } = options
  const stateFile = path.join(dir, 'state.json')
  const draftsDir = path.join(dir, 'drafts')
  let current: StateFilesRead = { state: null, drafts: {}, error: null, readAt: null }
  let signature = ''
  let stateText: string | null = null
  let disposed = false
  const watchers = new Map<string, FSWatcher>()

  const refresh = (): void => {
    if (disposed) return
    let { state, error, readAt } = current
    let text: string | null = stateText
    try {
      text = readText(stateFile)
      if (text === null) {
        state = null
        error = null
        readAt = null
      } else if (text !== stateText || error) {
        state = normalize(JSON.parse(text))
        error = null
        if (text !== stateText) readAt = new Date().toISOString()
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    stateText = text
    const drafts: Record<string, string> = {}
    for (const draft of state?.drafts ?? []) {
      if (!OPEN_DRAFT.has(draft.statut) || !SAFE_ID.test(draft.id)) continue
      try {
        const text = readText(path.join(draftsDir, `${draft.id}.md`))
        if (text !== null) drafts[draft.id] = text
      } catch { /* a draft being written: the next poll reads it */ }
    }
    const nextSignature = JSON.stringify([stateText, drafts, error])
    if (nextSignature === signature) return
    const first = signature === ''
    signature = nextSignature
    current = { state, drafts, error, readAt }
    if (!first) options.onChange(current)
  }

  const ensureWatch = (target: string): void => {
    if (disposed || watchers.has(target) || !existsSync(target)) return
    try {
      const watcher = watch(target, refresh)
      watcher.on('error', () => { watcher.close(); watchers.delete(target) })
      watchers.set(target, watcher)
    } catch { /* the poll covers it */ }
  }
  const tick = (): void => {
    ensureWatch(dir)
    ensureWatch(draftsDir)
    refresh()
  }

  tick()
  const timer = setInterval(tick, options.pollMs ?? 2000)
  timer.unref()

  return {
    read: () => current,
    dispose() {
      disposed = true
      clearInterval(timer)
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    },
  }
}
