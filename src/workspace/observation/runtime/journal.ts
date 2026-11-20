// The journal: `<data>/observations/<AAAA-MM-JJ>.jsonl`, one line per fact,
// append only, one file a day by the local date (FR-001). The runtime is its
// only writer. Nothing is written, not even the folder, while the person has
// not accepted or has paused (FR-003, FR-004).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Logger } from '@kernel/log/contract'
import { cleanInput, journalFileName, localDay, type Observation } from '../contract'

/** Lines wait this long for the disk, so a burst is one write. */
const FLUSH_DELAY_MS = 250
/** Lines that may wait for the disk; past it a new fact is dropped. */
const MAX_QUEUED = 1_000

export interface JournalDeps {
  /** `<data>/observations`; created with the first line, never before. */
  dir: string
  now: () => number
  /** The person accepted and did not pause. Read for every fact and again before every write. */
  active: () => boolean
  /** The domains refused right now. */
  exclusions: () => readonly string[]
  log: Logger
  flushDelayMs?: number
  maxQueued?: number
}

export interface Journal {
  /**
   * Queues a fact for the file of today. False when it is refused: not
   * active, the writes stopped, not a clean fact (`cleanInput`), or too many
   * wait. Never throws and never waits for the disk.
   */
  append(input: unknown): boolean
  /** Writes what waits. */
  flush(): Promise<void>
  /** Why the writes stopped by themselves (disk full, file unreadable), else null. */
  failure(): string | null
  /** Writes what waits and refuses every later fact. */
  dispose(): Promise<void>
}

export function createJournal(deps: JournalDeps): Journal {
  const delay = deps.flushDelayMs ?? FLUSH_DELAY_MS
  const limit = deps.maxQueued ?? MAX_QUEUED
  let queue: { day: string; line: string }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let failed: string | null = null
  let disposed = false
  let writing: Promise<void> = Promise.resolve()

  const write = async (): Promise<void> => {
    const batch = queue
    queue = []
    // A pause, a withdrawn accord or a failure stops the writes at once: what waited is lost.
    if (batch.length === 0 || failed !== null || !deps.active()) return
    const byDay = new Map<string, string>()
    for (const { day, line } of batch) byDay.set(day, (byDay.get(day) ?? '') + line)
    try {
      await fs.mkdir(deps.dir, { recursive: true, mode: 0o700 })
      for (const [day, text] of byDay) await fs.appendFile(path.join(deps.dir, journalFileName(day)), text, { mode: 0o600 })
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err)
      // The app and its panels go on; the journal stops and says so.
      deps.log.warn('observation journal stopped, nothing more is written: %s', failed)
    }
  }

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = null
    writing = writing.then(write)
    return writing
  }

  return {
    append(input) {
      if (disposed || failed !== null || !deps.active() || queue.length >= limit) return false
      const clean = cleanInput(input, deps.exclusions())
      if (clean === null) return false
      const at = deps.now()
      const observation: Observation = { ts: new Date(at).toISOString(), ...clean }
      queue.push({ day: localDay(at), line: `${JSON.stringify(observation)}\n` })
      if (!timer) {
        timer = setTimeout(() => { void flush() }, delay)
        timer.unref()
      }
      return true
    },
    flush,
    failure: () => failed,
    async dispose() {
      await flush()
      disposed = true
    },
  }
}
