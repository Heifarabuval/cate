// The journal keeps 14 days, one file a day, named by the local date of the
// clock (`AAAA-MM-JJ.jsonl`). Pure arithmetic on day names: the purge reads
// the name of a file, never its modification time.

/** Days a journal file lives: a file of this age stays, the next day it goes. */
export const RETENTION_DAYS = 14

const DAY_MS = 86_400_000
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/** UTC midnight of a day name (`AAAA-MM-JJ`); NaN when the name is not a date. */
const utcOf = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/** A name of the form `AAAA-MM-JJ` that is a day of the calendar: `2026-02-30` is not one. */
function isCalendarDay(day: string): boolean {
  const ms = utcOf(day)
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(day)
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The local date of a clock reading, as a day name. */
export function localDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** Whole calendar days from `day` to `today`; negative for a day in the future. Both are valid day names. */
export function dayAge(day: string, today: string): number {
  return Math.round((utcOf(today) - utcOf(day)) / DAY_MS)
}

export function journalFileName(day: string): string {
  return `${day}.jsonl`
}

/** The day a journal file holds, or null for any other name. */
export function parseJournalFileName(name: string): string | null {
  const day = FILE.exec(name)?.[1]
  return day !== undefined && isCalendarDay(day) ? day : null
}
