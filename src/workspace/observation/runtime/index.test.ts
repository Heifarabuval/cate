import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiHandlerContext } from '@kernel/api/contract'
import { createObservationRuntime, observationApiHandlers, observationCapabilityImpl, type ObservationRuntime, type ObservationSettings } from './index'
import { clock, doc, fakeDocument, op, panel, recordingLog, relation, tempDir, writeDay } from './testing.test-helpers'

type Values = { observationAccord: string; observationPause: boolean; observationExclusionsAjoutees: string[]; observationExclusionsRetirees: string[] }
const ACCEPTED = '2026-11-01T09:00:00.000Z'

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}

describe('the observation runtime', () => {
  let tmp: ReturnType<typeof tempDir>
  let dir: string
  let time: ReturnType<typeof clock>
  let logs: ReturnType<typeof recordingLog>
  let values: Values
  let runtime: ObservationRuntime

  const settings: ObservationSettings = { get: (key) => values[key] }
  const open = () => createObservationRuntime({ dir, settings, now: time.now, log: logs.log })
  const journalFile = () => path.join(dir, '2026-11-20.jsonl')
  const written = () => readFileSync(journalFile(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

  beforeEach(() => {
    tmp = tempDir()
    dir = path.join(tmp.dir, 'observations')
    time = clock(2026, 11, 20, 10, 0)
    logs = recordingLog()
    values = { observationAccord: '', observationPause: false, observationExclusionsAjoutees: [], observationExclusionsRetirees: [] }
    runtime = open()
  })
  afterEach(async () => {
    await runtime.dispose()
    vi.useRealTimers()
    tmp.remove()
  })

  it('creates no folder and no file in a new workspace, whatever happens in it', async () => {
    const document = fakeDocument()
    runtime.watchDocument(document.source)
    await runtime.start()
    document.emit(op({ kind: 'addPanel' }), doc([]), doc([panel('p1', 'browser')]))
    runtime.navigated('https://example.com/a')
    await runtime.flush()
    await runtime.dispose()
    expect(existsSync(dir)).toBe(false)
    expect(runtime.state()).toEqual({ accord: null, pause: false, actif: false, erreur: null })
  })

  it('writes the panels of the document and the navigations once the person accepted', async () => {
    values.observationAccord = ACCEPTED
    const document = fakeDocument()
    runtime.watchDocument(document.source)
    const terminal = panel('t1', 'terminal')
    document.emit(op({ kind: 'addPanel' }), doc([terminal]), doc([terminal, panel('b1', 'browser')]))
    document.emit(op({ kind: 'addRelation' }), doc([terminal, panel('b1', 'browser')]), doc([terminal, panel('b1', 'browser')], [relation('r1', 'b1', 't1')]))
    runtime.navigated('https://example.com/a/b?token=abc#x')
    await runtime.flush()
    expect(written().map((line) => [line.kind, line.panelType, line.ref])).toEqual([
      ['panel.created', 'browser', 'b1'],
      ['panel.linked', 'browser', 'b1'],
      ['navigate', 'browser', 'https://example.com/a/b'],
    ])
  })

  it('follows the settings at every fact: pause, resume, accord withdrawn', async () => {
    values.observationAccord = ACCEPTED
    runtime.navigated('https://example.com/1')
    await runtime.flush()
    values.observationPause = true
    runtime.navigated('https://example.com/2')
    await runtime.flush()
    values.observationPause = false
    runtime.navigated('https://example.com/3')
    await runtime.flush()
    values.observationAccord = ''
    runtime.navigated('https://example.com/4')
    await runtime.flush()
    expect(written().map((line) => line.ref)).toEqual(['https://example.com/1', 'https://example.com/3'])
  })

  it('writes nothing of an excluded domain, default or added, and writes a default domain the person took back', async () => {
    values.observationAccord = ACCEPTED
    values.observationExclusionsAjoutees = ['exemple.fr']
    runtime.navigated('https://mail.google.com/mail/u/0/')
    runtime.navigated('https://www.exemple.fr/compte')
    runtime.navigated('https://example.com/ok')
    await runtime.flush()
    expect(written().map((line) => line.ref)).toEqual(['https://example.com/ok'])

    values.observationExclusionsRetirees = ['mail.google.com']
    runtime.navigated('https://mail.google.com/mail/u/0/')
    await runtime.flush()
    expect(written().map((line) => line.ref)).toEqual(['https://example.com/ok', 'https://mail.google.com/mail/u/0/'])
  })

  it('leaves no value of an input in any file, nor in the logs', async () => {
    values.observationAccord = ACCEPTED
    const document = fakeDocument()
    runtime.watchDocument(document.source)
    const secrets = [
      'S3cretPw', 'aB3dE5gH7jK9mN1pQ', 'TOK-123', 'a@b.fr', 'frag-456', 'Plan secret', 'ABC-123', 'JSESSION-9',
      'jane.doe', 'dG9rZW4', 'abcdefghijklmnop', 'c2VjcmV0', 'john%40',
    ]
    runtime.navigated('https://user:S3cretPw@example.com/reset/aB3dE5gH7jK9mN1pQ/x;jsessionid=JSESSION-9?token=TOK-123&email=a@b.fr#frag-456')
    runtime.navigated('https://example.com/u/jane.doe@example.com/t/dG9rZW4=/s/abcdefghijklmnop/v/c2VjcmV0+/m/john%40example.com')
    document.emit(op({ kind: 'addPanel' }), doc([]), doc([{ ...panel('p1', 'editor', 'Plan secret ABC-123'), fields: { filePath: '/Users/me/ABC-123.md' } }]))
    await runtime.flush()
    expect(files(tmp.dir).length).toBeGreaterThan(0)
    for (const file of files(tmp.dir)) {
      const text = readFileSync(file, 'utf8')
      for (const secret of secrets) expect(text, `${secret} in ${path.relative(tmp.dir, file)}`).not.toContain(secret)
    }
    expect(logs.warnings.join('\n')).toBe('')
  })

  it('says where it stands', async () => {
    expect(runtime.state()).toEqual({ accord: null, pause: false, actif: false, erreur: null })
    values.observationAccord = ACCEPTED
    expect(runtime.state()).toEqual({ accord: ACCEPTED, pause: false, actif: true, erreur: null })
    values.observationPause = true
    expect(runtime.state()).toEqual({ accord: ACCEPTED, pause: true, actif: false, erreur: null })
    expect(await observationCapabilityImpl(runtime).state(undefined as never, undefined as never)).toEqual(runtime.state())
  })

  it('says why it stopped when the disk refuses, and the rest goes on', async () => {
    values.observationAccord = ACCEPTED
    writeFileSync(dir, 'a file where the folder should be')
    runtime.navigated('https://example.com/a')
    await runtime.flush()
    expect(runtime.state()).toMatchObject({ actif: false, erreur: expect.any(String) })
    expect(() => runtime.navigated('https://example.com/b')).not.toThrow()
  })

  it('purges the old files at start, then every day', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    writeDay(dir, '2026-11-05.jsonl', '{}\n')
    writeDay(dir, '2026-11-06.jsonl', '{}\n')
    await runtime.start()
    expect(readdirSync(dir)).toEqual(['2026-11-06.jsonl'])

    writeDay(dir, '2026-11-01.jsonl', '{}\n')
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    await vi.waitFor(() => expect(readdirSync(dir)).toEqual(['2026-11-06.jsonl']))
  })

  it('lists the journal it wrote and changes nothing', async () => {
    values.observationAccord = ACCEPTED
    runtime.navigated('https://example.com/a')
    await runtime.flush()
    const before = statSync(journalFile()).mtimeMs
    const listing = await runtime.list(14, true)
    expect(listing).toMatchObject({ total: 1, illisibles: 0, jours: 14, types: [{ kind: 'navigate', panelType: 'browser', count: 1 }] })
    expect(listing.observations?.[0]).toMatchObject({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/a' })
    expect(statSync(journalFile()).mtimeMs).toBe(before)
    expect(readdirSync(dir)).toEqual(['2026-11-20.jsonl'])
  })

  it('counts by type and gives no ref unless they are asked for', async () => {
    values.observationAccord = ACCEPTED
    const document = fakeDocument()
    runtime.watchDocument(document.source)
    document.emit(op({ kind: 'addPanel' }), doc([]), doc([panel('p-private-id', 'browser')]))
    runtime.navigated('https://example.com/private/page')
    runtime.navigated('https://example.com/private/other')
    await runtime.flush()

    const summary = await runtime.list(14, false)
    expect(summary).toEqual({
      jours: 14,
      total: 3,
      illisibles: 0,
      types: [{ kind: 'navigate', panelType: 'browser', count: 2 }, { kind: 'panel.created', panelType: 'browser', count: 1 }],
    })
    expect('observations' in summary).toBe(false)
    expect(JSON.stringify(summary)).not.toMatch(/example\.com|private|p-private-id/)

    const full = await runtime.list(14, true)
    expect(full.observations?.map((one) => one.ref)).toEqual(['p-private-id', 'https://example.com/private/page', 'https://example.com/private/other'])
    expect(full.types).toEqual(summary.types)
  })

  it('counts the lines it cannot read apart, and the days asked only', async () => {
    values.observationAccord = ACCEPTED
    runtime.navigated('https://example.com/a')
    await runtime.flush()
    writeDay(dir, '2026-11-19.jsonl', 'not json\n')
    writeDay(dir, '2026-11-10.jsonl', '{"ts":"2026-11-10T09:00:00.000Z","kind":"panel.created","panelType":"browser","ref":"ten-days-ago"}\n')
    writeDay(dir, '2026-11-01.jsonl', '{"ts":"2026-11-01T09:00:00.000Z","kind":"panel.created","panelType":"browser","ref":"too-old"}\n')
    expect(await runtime.list(1, false)).toMatchObject({ total: 1, illisibles: 1, jours: 1 })
    expect(await runtime.list(14, false)).toMatchObject({ total: 2, illisibles: 1, jours: 14 })
  })

  it('never lets a failure of its own reach the browser panel that tells it of a page', () => {
    const broken = createObservationRuntime({ dir, settings: { get: () => { throw new Error('settings are gone') } }, now: time.now, log: logs.log })
    expect(() => broken.navigated('https://example.com/a')).not.toThrow()
    expect(logs.warnings).toEqual(['observation could not take a fact: settings are gone'])
  })

  it('says so when the purge fails, and never rejects', async () => {
    writeFileSync(dir, 'a file where the folder should be')
    await expect(runtime.start()).resolves.toBeUndefined()
    expect(logs.warnings).toEqual([expect.stringMatching(/^observation purge failed: /)])
  })

  it('stops watching the document and writing once disposed', async () => {
    values.observationAccord = ACCEPTED
    const document = fakeDocument()
    runtime.watchDocument(document.source)
    expect(document.listeners()).toBe(1)
    runtime.navigated('https://example.com/a')
    await runtime.dispose()
    expect(document.listeners()).toBe(0)
    expect(written()).toHaveLength(1)
    runtime.navigated('https://example.com/b')
    await runtime.dispose()
    expect(written()).toHaveLength(1)
  })
})

describe('cate.observe.list', () => {
  const ctx = (kind: 'cli' | 'client') => ({ caller: { kind, id: 'caller' } }) as ApiHandlerContext
  const listing = { total: 0, illisibles: 0, jours: 3, types: [] }
  const list = vi.fn(async () => listing)
  const handlers = observationApiHandlers({ list })

  it('serves a terminal of the machine, with the refs only when it asks for them', async () => {
    expect(await handlers.list({ jours: 3, refs: false }, ctx('cli'))).toBe(listing)
    expect(list).toHaveBeenLastCalledWith(3, false)
    await handlers.list({ jours: 0, refs: true }, ctx('cli'))
    expect(list).toHaveBeenLastCalledWith(0, true)
  })

  it('never serves a client: the journal does not cross the protocol', async () => {
    list.mockClear()
    for (const refs of [false, true]) {
      await expect(Promise.resolve().then(() => handlers.list({ jours: 3, refs }, ctx('client')))).rejects.toMatchObject({
        code: 'rejected',
        message: expect.stringMatching(/^observation-list-local-only/),
      })
    }
    expect(list).not.toHaveBeenCalled()
  })
})
