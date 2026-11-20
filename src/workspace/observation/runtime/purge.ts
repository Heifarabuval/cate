// The retention: a journal file older than 14 days goes (FR-009). The age is
// read from the name of the file, a local date, never from its modification
// time. A name that is not a day is reported and never removed.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Logger } from '@kernel/log/contract'
import { RETENTION_DAYS, dayAge, localDay, parseJournalFileName } from '../contract'

export interface PurgeResult {
  /** The files removed. */
  removed: string[]
  /** What the folder holds that is not a day of the journal: left alone. */
  ignored: string[]
}

export async function purgeJournal(options: { dir: string; now: number; log: Logger }): Promise<PurgeResult> {
  const { dir, log } = options
  const result: PurgeResult = { removed: [], ignored: [] }
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    // No folder is the state of a workspace that never accepted: nothing to purge, nothing to create.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw err
  }
  const today = localDay(options.now)
  for (const entry of entries) {
    const day = entry.isFile() ? parseJournalFileName(entry.name) : null
    if (day === null) {
      result.ignored.push(entry.name)
      log.warn('observation purge leaves %s alone: it is not a day of the journal', entry.name)
      continue
    }
    if (dayAge(day, today) <= RETENTION_DAYS) continue
    try {
      await fs.rm(path.join(dir, entry.name), { force: true })
      result.removed.push(entry.name)
    } catch (err) {
      log.warn('observation purge could not remove %s: %s', entry.name, err instanceof Error ? err.message : String(err))
    }
  }
  return result
}
