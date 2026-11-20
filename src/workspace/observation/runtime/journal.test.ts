import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJournal, type Journal } from './journal'
import { clock, recordingLog, tempDir } from './testing.test-helpers'

const PANEL = '3f2a9c1e-7b4d-4e0a-9d51-0a1b2c3d4e5f'
const created = { kind: 'panel.created', panelType: 'browser', ref: PANEL } as const

describe('journal', () => {
  let tmp: ReturnType<typeof tempDir>
  let dir: string
  let time: ReturnType<typeof clock>
  let active: boolean
  let exclusions: string[]
  let logs: ReturnType<typeof recordingLog>
  let journal: Journal

  const open = (options: { maxQueued?: number; flushDelayMs?: number } = {}) => createJournal({
    dir,
    now: time.now,
    active: () => active,
    exclusions: () => exclusions,
    log: logs.log,
    ...options,
  })
  const lines = (name: string) => readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

  beforeEach(() => {
    tmp = tempDir()
    dir = path.join(tmp.dir, 'observations')
    time = clock(2026, 11, 20, 10, 0)
    active = true
    exclusions = []
    logs = recordingLog()
    journal = open()
  })
  afterEach(async () => {
    await journal.dispose()
    tmp.remove()
  })

  it('creates no folder and no file before the person accepts', async () => {
    active = false
    expect(journal.append(created)).toBe(false)
    await journal.flush()
    expect(existsSync(dir)).toBe(false)
  })

  it('creates nothing when it is only opened and flushed', async () => {
    await journal.flush()
    expect(existsSync(dir)).toBe(false)
  })

  it('writes one line {ts, kind, panelType, ref} in the file of the day', async () => {
    expect(journal.append(created)).toBe(true)
    await journal.flush()
    expect(readdirSync(dir)).toEqual(['2026-11-20.jsonl'])
    const [line, ...rest] = lines('2026-11-20.jsonl')
    expect(rest).toEqual([])
    expect(Object.keys(line)).toEqual(['ts', 'kind', 'panelType', 'ref'])
    expect(line).toEqual({ ts: new Date(time.now()).toISOString(), ...created })
  })

  it('appends after the lines already there, in the order of the facts', async () => {
    journal.append(created)
    await journal.flush()
    time.advance(1000)
    journal.append({ kind: 'panel.closed', panelType: 'browser', ref: PANEL })
    journal.append({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/a?token=abc#x' })
    await journal.flush()
    expect(lines('2026-11-20.jsonl').map((line) => [line.kind, line.ref])).toEqual([
      ['panel.created', PANEL],
      ['panel.closed', PANEL],
      ['navigate', 'https://example.com/a'],
    ])
  })

  it('creates the folder with mode 0700 and the file with mode 0600', async () => {
    journal.append(created)
    await journal.flush()
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(path.join(dir, '2026-11-20.jsonl')).mode & 0o777).toBe(0o600)
  })

  it('names the file by the local day of each fact', async () => {
    time.set(2026, 11, 20, 23, 59)
    journal.append(created)
    time.set(2026, 11, 21, 0, 1)
    journal.append(created)
    await journal.flush()
    expect(readdirSync(dir).sort()).toEqual(['2026-11-20.jsonl', '2026-11-21.jsonl'])
    expect(lines('2026-11-20.jsonl')).toHaveLength(1)
    expect(lines('2026-11-21.jsonl')).toHaveLength(1)
  })

  it('refuses a line that is not clean and writes nothing for it', async () => {
    const refused = [
      { ...created, kind: 'click' },
      { ...created, kind: 'terminal.command' },
      { ...created, extra: 'ABC-123' },
      { ...created, ref: 'a'.repeat(513) },
      { ...created, ref: 'Mon titre secret' },
      { ...created, panelType: 'toaster' },
      { kind: 'navigate', panelType: 'browser', ref: 'file:///Users/me/a.html' },
      'panel.created',
      null,
    ]
    for (const input of refused) expect(journal.append(input), JSON.stringify(input)).toBe(false)
    await journal.flush()
    expect(existsSync(dir)).toBe(false)
  })

  it('refuses a navigation to an excluded domain, whole, and keeps the other pages', async () => {
    exclusions = ['exemple.fr']
    expect(journal.append({ kind: 'navigate', panelType: 'browser', ref: 'https://www.exemple.fr/compte?id=1' })).toBe(false)
    expect(journal.append({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/ok' })).toBe(true)
    await journal.flush()
    const text = readFileSync(path.join(dir, '2026-11-20.jsonl'), 'utf8')
    expect(text).not.toContain('exemple.fr')
    expect(text).toContain('https://example.com/ok')
  })

  it('stops at once when the person pauses: what waited for the disk is dropped', async () => {
    expect(journal.append(created)).toBe(true)
    active = false
    await journal.flush()
    expect(existsSync(dir)).toBe(false)
    expect(journal.append(created)).toBe(false)
  })

  it('does not wait for the disk', () => {
    expect(journal.append(created)).toBe(true)
    expect(existsSync(dir)).toBe(false)
  })

  it('writes by itself after a short delay', async () => {
    await journal.dispose()
    journal = open({ flushDelayMs: 5 })
    journal.append(created)
    await vi.waitFor(() => expect(existsSync(path.join(dir, '2026-11-20.jsonl'))).toBe(true))
  })

  it('writes by itself 250 ms after the first fact of a burst, not before, and the burst in one go', async () => {
    // The timers are faked, the disk is not: give the disk real time to answer before looking.
    const file = path.join(dir, '2026-11-20.jsonl')
    const watchDisk = async (ms: number, done: () => boolean) => {
      const until = Date.now() + ms
      while (Date.now() < until && !done()) await new Promise((resolve) => setImmediate(resolve))
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await journal.dispose()
      journal = open()
      journal.append(created)
      await vi.advanceTimersByTimeAsync(249)
      await watchDisk(100, () => existsSync(dir))
      expect(existsSync(dir)).toBe(false)
      journal.append({ ...created, kind: 'panel.closed' })
      await vi.advanceTimersByTimeAsync(1)
      await watchDisk(1000, () => existsSync(file) && readFileSync(file, 'utf8').split('\n').filter(Boolean).length === 2)
      expect(lines('2026-11-20.jsonl').map((line) => line.kind)).toEqual(['panel.created', 'panel.closed'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the new facts when too many wait for the disk', async () => {
    await journal.dispose()
    journal = open({ maxQueued: 2 })
    expect(journal.append(created)).toBe(true)
    expect(journal.append(created)).toBe(true)
    expect(journal.append(created)).toBe(false)
    await journal.flush()
    expect(lines('2026-11-20.jsonl')).toHaveLength(2)
  })

  it('stops by itself when the disk refuses, says why, and never throws', async () => {
    writeFileSync(dir, 'a file where the folder should be')
    expect(journal.append(created)).toBe(true)
    await expect(journal.flush()).resolves.toBeUndefined()
    expect(journal.failure()).toEqual(expect.any(String))
    expect(logs.warnings.join('\n')).toMatch(/observation journal stopped/)
    expect(journal.append(created)).toBe(false)
  })

  it('writes what waits when it is disposed, then refuses', async () => {
    journal.append(created)
    await journal.dispose()
    expect(lines('2026-11-20.jsonl')).toHaveLength(1)
    expect(journal.append(created)).toBe(false)
  })
})
