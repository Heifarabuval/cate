import { describe, expect, it } from 'vitest'
import { RETENTION_DAYS, dayAge, journalFileName, localDay, parseJournalFileName } from './retention'

describe('retention', () => {
  it('keeps 14 days', () => {
    expect(RETENTION_DAYS).toBe(14)
  })

  it('names a day by the local date of the clock', () => {
    expect(localDay(new Date(2026, 10, 20, 0, 0, 1).getTime())).toBe('2026-11-20')
    expect(localDay(new Date(2026, 10, 20, 23, 59, 59).getTime())).toBe('2026-11-20')
    expect(localDay(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05')
  })

  it('counts whole calendar days between two day names', () => {
    expect(dayAge('2026-11-06', '2026-11-20')).toBe(14)
    expect(dayAge('2026-11-05', '2026-11-20')).toBe(15)
    expect(dayAge('2026-11-20', '2026-11-20')).toBe(0)
    expect(dayAge('2026-10-31', '2026-11-02')).toBe(2)
    expect(dayAge('2024-02-28', '2024-03-01')).toBe(2)
    expect(dayAge('2023-02-28', '2023-03-01')).toBe(1)
    expect(dayAge('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('is not moved by a change of summer time', () => {
    expect(dayAge('2026-03-28', '2026-03-30')).toBe(2)
    expect(dayAge('2026-03-07', '2026-03-09')).toBe(2)
    expect(dayAge('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('gives a negative age to a day in the future (a clock that went back)', () => {
    expect(dayAge('2026-11-22', '2026-11-20')).toBe(-2)
  })

  it('names the file of a day and reads the day of a file name', () => {
    expect(journalFileName('2026-11-20')).toBe('2026-11-20.jsonl')
    expect(parseJournalFileName('2026-11-20.jsonl')).toBe('2026-11-20')
    expect(parseJournalFileName('2024-02-29.jsonl')).toBe('2024-02-29')
  })

  it('refuses a name that is not a day of the calendar', () => {
    for (const name of [
      '2026-13-01.jsonl', '2026-02-30.jsonl', '2023-02-29.jsonl', '2026-00-10.jsonl', '2026-11-00.jsonl',
      'etat.json', '2026-11-20.jsonl.bak', 'notes.jsonl', '20261120.jsonl', '2026-11-20.JSONL', '2026-11-20', '.jsonl', '',
    ]) expect(parseJournalFileName(name), name).toBeNull()
  })
})
