import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJournal } from './read'
import { clock, recordingLog, tempDir, writeDay } from './testing.test-helpers'

const line = (ts: string, kind: string, ref: string, panelType = 'browser') => `${JSON.stringify({ ts, kind, panelType, ref })}\n`

describe('readJournal', () => {
  let tmp: ReturnType<typeof tempDir>
  let dir: string
  let time: ReturnType<typeof clock>
  let logs: ReturnType<typeof recordingLog>

  const read = (jours = 14) => readJournal({ dir, now: time.now(), jours, log: logs.log })

  beforeEach(() => {
    tmp = tempDir()
    dir = path.join(tmp.dir, 'observations')
    time = clock(2026, 11, 20, 10, 0)
    logs = recordingLog()
  })
  afterEach(() => tmp.remove())

  it('lists the lines of the days asked, oldest day first and in the order of the file', async () => {
    writeDay(dir, '2026-11-20.jsonl', line('2026-11-20T09:00:00.000Z', 'panel.created', 'p3') + line('2026-11-20T09:05:00.000Z', 'panel.closed', 'p3'))
    writeDay(dir, '2026-11-19.jsonl', line('2026-11-19T09:00:00.000Z', 'navigate', 'https://example.com/a'))
    const listing = await read()
    expect(listing.observations.map((one) => [one.kind, one.ref])).toEqual([
      ['navigate', 'https://example.com/a'],
      ['panel.created', 'p3'],
      ['panel.closed', 'p3'],
    ])
    expect(listing).toMatchObject({ total: 3, illisibles: 0, jours: 14 })
  })

  it('leaves out the days before the ones asked: 0 is today, 1 is today and yesterday', async () => {
    writeDay(dir, '2026-11-20.jsonl', line('2026-11-20T09:00:00.000Z', 'panel.created', 'today'))
    writeDay(dir, '2026-11-19.jsonl', line('2026-11-19T09:00:00.000Z', 'panel.created', 'yesterday'))
    writeDay(dir, '2026-11-18.jsonl', line('2026-11-18T09:00:00.000Z', 'panel.created', 'before'))
    expect((await read(0)).observations.map((one) => one.ref)).toEqual(['today'])
    expect((await read(1)).observations.map((one) => one.ref)).toEqual(['yesterday', 'today'])
    expect((await read(14)).total).toBe(3)
  })

  it('counts a line it cannot read and leaves the file as it is', async () => {
    const file = writeDay(dir, '2026-11-20.jsonl', [
      line('2026-11-20T09:00:00.000Z', 'panel.created', 'p1').trim(),
      '{"ts": "2026-11-20T09:01:00.000Z", "kind": "panel.cre',
      'not json at all',
      JSON.stringify({ ts: '2026-11-20T09:02:00.000Z', kind: 'click', panelType: 'browser', ref: 'Valider' }),
      JSON.stringify({ ts: '2026-11-20T09:03:00.000Z', kind: 'panel.created', panelType: 'browser', ref: 'p2', value: 'ABC-123' }),
      '',
      line('2026-11-20T09:04:00.000Z', 'panel.closed', 'p1').trim(),
    ].join('\n'))
    const before = readFileSync(file, 'utf8')
    const listing = await read()
    expect(listing.observations.map((one) => one.ref)).toEqual(['p1', 'p1'])
    expect(listing.illisibles).toBe(4)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('never shows a navigation that was edited to carry a parameter or a credential', async () => {
    writeDay(dir, '2026-11-20.jsonl', line('2026-11-20T09:00:00.000Z', 'navigate', 'https://example.com/a?token=SECRET-1') + line('2026-11-20T09:01:00.000Z', 'navigate', 'https://me:SECRET-2@example.com/a'))
    const listing = await read()
    expect(listing.observations).toEqual([])
    expect(JSON.stringify(listing)).not.toMatch(/SECRET/)
    expect(listing.illisibles).toBe(2)
  })

  it('does not look at a file that is not a day of the journal', async () => {
    writeDay(dir, 'etat.json', '{"a":1}')
    writeDay(dir, 'notes.jsonl', line('2026-11-20T09:00:00.000Z', 'panel.created', 'p1'))
    expect(await read()).toMatchObject({ observations: [], total: 0, illisibles: 0 })
  })

  it('lists a day after today, a clock that went back', async () => {
    writeDay(dir, '2026-11-22.jsonl', line('2026-11-22T09:00:00.000Z', 'panel.created', 'later'))
    expect((await read()).observations.map((one) => one.ref)).toEqual(['later'])
  })

  it('lists nothing, and creates nothing, when there is no folder', async () => {
    expect(await read()).toEqual({ observations: [], total: 0, illisibles: 0, jours: 14 })
    expect(existsSync(dir)).toBe(false)
  })
})
