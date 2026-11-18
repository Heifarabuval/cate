import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { antigravitySessionStore, antigravityUsageRecords } from './antigravity'

const SESSION = '8710be68-01ef-4bff-a501-c994e584cc8a'

// The steps agy 1.5.6 wrote in a real `agy -p` run
// (brain/<conversation>/.system_generated/logs/transcript_full.jsonl).
const steps = [
  { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-18T16:35:02Z', content: 'Read note.txt' },
  { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-18T16:35:03Z', input_tokens: 10782, cache_read_tokens: 0, output_tokens: 306, thinking: '...', tool_calls: [{ name: 'read_file', args: {} }] },
  { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'ERROR', error: 'tool call denied by pre-tool hook: ', created_at: '2026-11-18T16:35:08Z', content: 'denied' },
  { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-18T16:35:08Z', input_tokens: 2381, cache_read_tokens: 8738, output_tokens: 892, content: 'hello cate', thinking: '...' },
]

let home: string
let file: string

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'cate-agy-'))
  file = path.join(home, '.gemini', 'antigravity-cli', 'brain', SESSION, '.system_generated', 'logs', 'transcript_full.jsonl')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, steps.map((step) => JSON.stringify(step)).join('\n') + '\n')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const context = (transcriptPath?: string) => ({ session: { agentId: 'antigravity' as const, sessionId: SESSION, transcriptPath }, homeDir: home })

describe('antigravity session store', () => {
  it('reads the user input and the replies with text', async () => {
    expect(await antigravitySessionStore.conversation(context(file))).toEqual([
      { role: 'user', text: 'Read note.txt', createdAt: '2026-11-18T16:35:02.000Z' },
      { role: 'assistant', text: 'hello cate', createdAt: '2026-11-18T16:35:08.000Z' },
    ])
  })

  it('finds the transcript from the conversation id alone', async () => {
    expect(await antigravitySessionStore.files!(context())).toEqual([file])
    expect(await antigravitySessionStore.files!({ session: { agentId: 'antigravity', sessionId: '../etc' }, homeDir: home })).toEqual([])
  })

  it('counts each model response once; input excludes the cache read', () => {
    const records = steps.flatMap((step) => antigravityUsageRecords(JSON.stringify(step), SESSION))
    expect(records).toEqual([
      { timestampMs: Date.parse('2026-11-18T16:35:03Z'), model: 'antigravity', sessionId: SESSION, cwd: null,
        totals: { uncachedInputTokens: 10782, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 306, reasoningTokens: 0 },
        reportedCostUsd: null, dedupeKey: `${SESSION}:1` },
      { timestampMs: Date.parse('2026-11-18T16:35:08Z'), model: 'antigravity', sessionId: SESSION, cwd: null,
        totals: { uncachedInputTokens: 2381, cachedInputTokens: 8738, cacheCreationTokens: 0, outputTokens: 892, reasoningTokens: 0 },
        reportedCostUsd: null, dedupeKey: `${SESSION}:3` },
    ])
  })
})
