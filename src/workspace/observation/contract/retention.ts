// The journal keeps 14 days, one file a day, named by the local date of the
// clock (`AAAA-MM-JJ.jsonl`). Pure arithmetic on day names: the purge reads
// the name of a file, never its modification time.

/** Days a journal file lives: a file of this age stays, the next day it goes. */
export const RETENTION_DAYS = 14

const DAY_MS = 86_400_000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/** UTC midnight of a day name, or null when the name is not a day of the calendar. */
function utcOf(day: string): number | null {
  const match = DAY.exec(day)
  if (!match) return null
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ms = Date.UTC(year, month - 1, date)
  // `Date.UTC` rolls 2026-02-30 over to March: a day that rolled is not a day.
  const back = new Date(ms)
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === date ? ms : null
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The local date of a clock reading, as a day name. */
export function localDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** Whole calendar days from `day` to `today`; negative for a day in the future. Both are valid day names. */
export function dayAge(day: string, today: string): number {
  return Math.round((utcOf(today)! - utcOf(day)!) / DAY_MS)
}

export function journalFileName(day: string): string {
  return `${day}.jsonl`
}

/** The day a journal file holds, or null for any other name. */
export function parseJournalFileName(name: string): string | null {
  const match = FILE.exec(name)
  return match && utcOf(match[1]) !== null ? match[1] : null
}
