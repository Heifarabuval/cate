import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { geminiSessionStore, geminiUsageRecords } from './gemini'

const SESSION = '8fd7c046-7ac6-4c7a-ae25-b241eef5bedd'
const CWD = '/work/proj'

// The ConversationRecord gemini-cli-core 0.32.1 writes (chatRecordingService):
// one JSON file per session, rewritten on every message.
const record = {
  sessionId: SESSION,
  projectHash: 'abc',
  startTime: '2026-03-06T17:19:18.574Z',
  lastUpdated: '2026-03-06T17:22:57.954Z',
  kind: 'main',
  messages: [
    { id: 'u1', timestamp: '2026-03-06T17:19:18.574Z', type: 'user', content: [{ text: 'Review @a.ts expanded' }], displayContent: [{ text: 'Review @a.ts' }] },
    { id: 'i1', timestamp: '2026-03-06T17:19:19.000Z', type: 'info', content: 'Switched model' },
    { id: 'g1', timestamp: '2026-03-06T17:20:30.950Z', type: 'gemini', content: '', thoughts: [], toolCalls: [{ name: 'read_file' }],
      tokens: { input: 8935, output: 80, cached: 1000, thoughts: 450, tool: 0, total: 9465 }, model: 'gemini-3-flash-preview' },
    { id: 'g2', timestamp: '2026-03-06T17:22:57.954Z', type: 'gemini', content: 'No defect found.', thoughts: [],
      tokens: { input: 22064, output: 60, cached: 19697, thoughts: 491, tool: 10, total: 22625 }, model: 'gemini-3-pro' },
  ],
}

let home: string
let bucket: string
let file: string

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'cate-gemini-'))
  bucket = path.join(home, '.gemini', 'tmp', 'proj')
  await mkdir(path.join(bucket, 'chats'), { recursive: true })
  await writeFile(path.join(bucket, '.project_root'), CWD)
  file = path.join(bucket, 'chats', 'session-2026-03-06T17-19-8fd7c046.json')
  await writeFile(file, JSON.stringify(record, null, 2))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const context = (transcriptPath?: string) => ({ session: { agentId: 'gemini' as const, sessionId: SESSION, cwd: CWD, transcriptPath }, homeDir: home })

describe('gemini session store', () => {
  it('reads the visible turns, the user turn as typed', async () => {
    expect(await geminiSessionStore.conversation(context(file))).toEqual([
      { role: 'user', text: 'Review @a.ts', createdAt: '2026-03-06T17:19:18.574Z' },
      { role: 'assistant', text: 'No defect found.', createdAt: '2026-03-06T17:22:57.954Z' },
    ])
  })

  it('finds the session file without the hook transcript path', async () => {
    expect(await geminiSessionStore.files!(context())).toEqual([file])
    expect(await geminiSessionStore.files!({ session: { agentId: 'gemini', sessionId: '11111111-0000-4000-8000-000000000000' }, homeDir: home })).toEqual([])
  })

  it('uses the summary as title, none before gemini writes one', async () => {
    expect(await geminiSessionStore.title(context(file))).toBeNull()
    await writeFile(file, JSON.stringify({ ...record, summary: 'Review of PR 36' }))
    expect(await geminiSessionStore.title(context(file))).toBe('Review of PR 36')
  })

  it('counts each reply once, thoughts as output and tool prompts as input', () => {
    const [first, second] = geminiUsageRecords(record, CWD)
    expect(first).toEqual({
      timestampMs: Date.parse('2026-03-06T17:20:30.950Z'),
      model: 'gemini-3-flash-preview',
      sessionId: SESSION,
      cwd: CWD,
      totals: { uncachedInputTokens: 7935, cachedInputTokens: 1000, cacheCreationTokens: 0, outputTokens: 530, reasoningTokens: 450 },
      reportedCostUsd: null,
      dedupeKey: `${SESSION}:g1`,
    })
    expect(second.totals).toEqual({ uncachedInputTokens: 2377, cachedInputTokens: 19697, cacheCreationTokens: 0, outputTokens: 551, reasoningTokens: 491 })
  })

  it('reads the usage of the sessions written in the window, with their project root', async () => {
    const source = geminiSessionStore.usage.source
    if (source.kind !== 'store') throw new Error('gemini usage is a store')
    expect(source.location(home)).toBe(path.join(home, '.gemini', 'tmp'))
    const records = await source.records(home, Date.parse('2026-03-06T17:21:00.000Z'))
    expect(records?.map((r) => [r.dedupeKey, r.cwd])).toEqual([[`${SESSION}:g2`, CWD]])
    await utimes(file, new Date('2020-01-01'), new Date('2020-01-01'))
    expect(await source.records(home, Date.parse('2026-03-06T17:21:00.000Z'))).toEqual([])
  })
})
