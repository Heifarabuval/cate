import path from 'node:path'
import type { AgentConversationMessage } from '../../contract'
import { parseJsonLine, tokenCount } from '../usage/records'
import { SAFE_SESSION_ID, exists, forEachJsonlRecord, isoTimestamp, withReadOnlySqlite } from './storeFiles'
import type { AgentSessionContext, AgentSessionStore, AgentUsage, AgentUsageRecord } from './types'

/**
 * agy 1.5.6 keeps each conversation under
 * `~/.gemini/antigravity-cli/brain/<conversation id>/`, its steps in
 * `.system_generated/logs/transcript_full.jsonl` (the hooks' transcriptPath),
 * and its picker list in `~/.gemini/antigravity-cli/conversation_summaries.db`.
 * Shapes read from a real `agy -p` run. Cate only reads them.
 */
const cliRoot = (homeDir: string): string => path.join(homeDir, '.gemini', 'antigravity-cli')
const TRANSCRIPT = 'transcript_full.jsonl'

async function locate({ session, homeDir }: AgentSessionContext): Promise<string | null> {
  if (session.transcriptPath && await exists(session.transcriptPath)) return session.transcriptPath
  if (!SAFE_SESSION_ID.test(session.sessionId)) return null
  const file = path.join(cliRoot(homeDir), 'brain', session.sessionId, '.system_generated', 'logs', TRANSCRIPT)
  return await exists(file) ? file : null
}

/** The conversation's `title` in agy's summaries; empty until agy names it. */
async function title({ session, homeDir }: AgentSessionContext): Promise<string | null> {
  const row = await withReadOnlySqlite(path.join(cliRoot(homeDir), 'conversation_summaries.db'), (db) =>
    db.prepare('SELECT title FROM conversation_summaries WHERE conversation_id = ?').get(session.sessionId) as { title?: unknown } | undefined)
  return typeof row?.title === 'string' && row.title.trim() ? row.title : null
}

/** USER_INPUT steps are the prompts; PLANNER_RESPONSE steps with `content`
 *  are the replies (a response with only tool calls has none). */
async function conversation(context: AgentSessionContext): Promise<AgentConversationMessage[] | null> {
  const file = await locate(context)
  if (!file) return null
  const messages: AgentConversationMessage[] = []
  const read = await forEachJsonlRecord(file, (step) => {
    const role = step.type === 'USER_INPUT' ? 'user' : step.type === 'PLANNER_RESPONSE' ? 'assistant' : null
    const text = typeof step.content === 'string' ? step.content.trim() : ''
    if (!role || !text) return
    const createdAt = isoTimestamp(step.created_at)
    messages.push({ role, text, ...(createdAt ? { createdAt } : {}) })
  })
  return read ? messages : null
}

const files = async (context: AgentSessionContext): Promise<string[]> => {
  const file = await locate(context)
  return file ? [file] : []
}

/**
 * Each PLANNER_RESPONSE step records its call's tokens: `input_tokens`
 * without the `cache_read_tokens` part, and `output_tokens`. No model and no
 * cost are recorded; the step does not say where the session ran (cwd null).
 */
export function antigravityUsageRecords(text: string, sessionId: string): AgentUsageRecord[] {
  if (!text.includes('"PLANNER_RESPONSE"')) return []
  const step = parseJsonLine(text)
  const timestampMs = typeof step?.created_at === 'string' ? Date.parse(step.created_at) : NaN
  if (!step || step.type !== 'PLANNER_RESPONSE' || Number.isNaN(timestampMs)) return []
  const totals = {
    uncachedInputTokens: tokenCount(step.input_tokens),
    cachedInputTokens: tokenCount(step.cache_read_tokens),
    cacheCreationTokens: 0,
    outputTokens: tokenCount(step.output_tokens),
    reasoningTokens: 0,
  }
  if (totals.uncachedInputTokens + totals.cachedInputTokens + totals.outputTokens === 0) return []
  return [{
    timestampMs, model: 'antigravity', sessionId, cwd: null, totals, reportedCostUsd: null,
    dedupeKey: typeof step.step_index === 'number' ? `${sessionId}:${step.step_index}` : null,
  }]
}

/** `brain/<conversation id>/.system_generated/logs/transcript_full.jsonl`. */
const sessionOf = (file: string): string => path.basename(path.dirname(path.dirname(path.dirname(file))))

const antigravityUsage: AgentUsage = {
  source: {
    kind: 'transcripts',
    root: (homeDir) => path.join(cliRoot(homeDir), 'brain'),
    fileName: TRANSCRIPT,
    parser: (file, state) => {
      if (state !== undefined && state !== null) return null
      const sessionId = sessionOf(file)
      return { line: (text) => antigravityUsageRecords(text, sessionId), state: () => null }
    },
  },
}

export const antigravitySessionStore: AgentSessionStore = { title, conversation, files, usage: antigravityUsage }
