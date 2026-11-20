import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { purgeJournal } from './purge'
import { clock, recordingLog, tempDir, writeDay } from './testing.test-helpers'

const NOW = [2026, 11, 20, 10, 0] as const

describe('purgeJournal', () => {
  let tmp: ReturnType<typeof tempDir>
  let dir: string
  let time: ReturnType<typeof clock>
  let logs: ReturnType<typeof recordingLog>

  const run = () => purgeJournal({ dir, now: time.now(), log: logs.log })

  beforeEach(() => {
    tmp = tempDir()
    dir = path.join(tmp.dir, 'observations')
    time = clock(...NOW)
    logs = recordingLog()
  })
  afterEach(() => tmp.remove())

  it('keeps J-13 and J-14, removes J-15 and older (simulated clock)', async () => {
    for (const name of ['2026-11-20', '2026-11-07', '2026-11-06', '2026-11-05', '2026-10-01']) writeDay(dir, `${name}.jsonl`, '{}\n')
    const result = await run()
    expect(readdirSync(dir).sort()).toEqual(['2026-11-06.jsonl', '2026-11-07.jsonl', '2026-11-20.jsonl'])
    expect(result.removed.sort()).toEqual(['2026-10-01.jsonl', '2026-11-05.jsonl'])
  })

  it('moves with the clock: J-14 stays until midnight, then goes', async () => {
    writeDay(dir, '2026-11-06.jsonl', '{}\n')
    time.set(2026, 11, 20, 23, 59)
    await run()
    expect(existsSync(path.join(dir, '2026-11-06.jsonl'))).toBe(true)
    time.set(2026, 11, 21, 0, 1)
    await run()
    expect(existsSync(path.join(dir, '2026-11-06.jsonl'))).toBe(false)
  })

  it('goes by the name of the file, never by its modification time', async () => {
    const recent = time.now()
    const old = time.at(2026, 1, 1)
    writeDay(dir, '2026-11-05.jsonl', '{}\n', recent)
    writeDay(dir, '2026-11-20.jsonl', '{}\n', old)
    await run()
    expect(readdirSync(dir)).toEqual(['2026-11-20.jsonl'])
  })

  it('ignores and reports a name that is not a day, and never deletes it', async () => {
    const odd = ['notes.jsonl', '2026-13-40.jsonl', 'etat.json', 'readme.txt', '2025-01-01.jsonl.bak']
    for (const name of odd) writeDay(dir, name, 'x', time.at(2020, 1, 1))
    const result = await run()
    expect(readdirSync(dir).sort()).toEqual([...odd].sort())
    expect(result.removed).toEqual([])
    expect(result.ignored.sort()).toEqual([...odd].sort())
    expect(logs.warnings.join('\n')).toContain('notes.jsonl')
  })

  it('leaves a folder named like a day alone', async () => {
    mkdirSync(path.join(dir, '2020-01-01.jsonl'), { recursive: true })
    const result = await run()
    expect(existsSync(path.join(dir, '2020-01-01.jsonl'))).toBe(true)
    expect(result.removed).toEqual([])
    expect(result.ignored).toEqual(['2020-01-01.jsonl'])
  })

  it('keeps a file dated in the future, a clock that went back', async () => {
    writeDay(dir, '2026-11-25.jsonl', '{}\n')
    await run()
    expect(existsSync(path.join(dir, '2026-11-25.jsonl'))).toBe(true)
  })

  it('does nothing and creates nothing when there is no folder', async () => {
    expect(await run()).toEqual({ removed: [], ignored: [] })
    expect(existsSync(dir)).toBe(false)
  })
})
