// Reads the journal back, for `cate observe list`. Read only: no file is
// written, none is created, a line that cannot be read stays where it is
// (a hand edit, a crash that tore a line, a line of another version).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Logger } from '@kernel/log/contract'
import { dayAge, localDay, parseJournalFileName, parseObservation, type Observation } from '../contract'

export interface JournalRead {
  /** The clean lines of the days asked, oldest first. */
  observations: Observation[]
  /** Lines that are not a clean observation, left in their file. */
  illisibles: number
}

/** The lines of today and of the `jours` days before. */
export async function readJournal(options: { dir: string; now: number; jours: number; log: Logger }): Promise<JournalRead> {
  const { dir, jours, log } = options
  const read: JournalRead = { observations: [], illisibles: 0 }
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return read
    throw err
  }
  const today = localDay(options.now)
  const days = names
    .flatMap((name) => { const day = parseJournalFileName(name); return day === null ? [] : [{ name, day }] })
    // A day after today is a clock that went back: its lines are still lines of the journal.
    .filter(({ day }) => dayAge(day, today) <= jours)
    .sort((a, b) => a.day.localeCompare(b.day))
  for (const { name } of days) {
    let text: string
    try {
      text = await fs.readFile(path.join(dir, name), 'utf8')
    } catch (err) {
      log.warn('observation list could not read %s: %s', name, err instanceof Error ? err.message : String(err))
      continue
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let observation: Observation | null = null
      try {
        observation = parseObservation(JSON.parse(line))
      } catch { /* not JSON: counted below */ }
      if (observation) read.observations.push(observation)
      else read.illisibles += 1
    }
  }
  return read
}
