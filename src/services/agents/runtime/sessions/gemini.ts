import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AgentConversationMessage } from '../../contract'
import { tokenCount, totalsFromInclusiveInput } from '../usage/records'
import { exists, firstInWorkspaceBuckets, isoTimestamp, object } from './storeFiles'
import type { AgentSessionContext, AgentSessionStore, AgentUsage, AgentUsageRecord } from './types'

/**
 * Gemini CLI 0.32.1 (chatRecordingService.js) keeps one JSON file per session at
 * `~/.gemini/tmp/<project>/chats/session-<minute>-<first 8 of id>.json`,
 * rewritten whole on every message, and `<project>/.project_root` names the
 * project's directory. Hooks carry the file as `transcript_path`.
 */
const tmpRoot = (homeDir: string): string => path.join(homeDir, '.gemini', 'tmp')

async function readRecord(file: string): Promise<Record<string, unknown> | null> {
  try {
    return object(JSON.parse(await readFile(file, 'utf8'))) ?? null
  } catch {
    // Missing, or caught mid-rewrite: the next read sees it whole.
    return null
  }
}

async function locate({ session, homeDir }: AgentSessionContext): Promise<string | null> {
  if (session.transcriptPath && await exists(session.transcriptPath)) return session.transcriptPath
  const suffix = `-${session.sessionId.slice(0, 8)}.json`
  return firstInWorkspaceBuckets(tmpRoot(homeDir), session.sessionId, async (bucketDir) => {
    const chats = path.join(bucketDir, 'chats')
    for (const name of await readdir(chats).catch(() => [])) {
      if (!name.startsWith('session-') || !name.endsWith(suffix)) continue
      const file = path.join(chats, name)
      if ((await readRecord(file))?.sessionId === session.sessionId) return file
    }
    return null
  })
}

/** A user message's parts as text (`displayContent` is what was typed). */
function partsText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => object(part)?.text).filter((text) => typeof text === 'string').join('')
}

/** Gemini writes `summary` when it summarizes a session; its picker falls
 *  back to the first prompt, which Cate already shows. */
async function title(context: AgentSessionContext): Promise<string | null> {
  const file = await locate(context)
  const summary = file ? (await readRecord(file))?.summary : null
  return typeof summary === 'string' && summary.trim() ? summary : null
}

/** `user` and `gemini` messages are the turns; `info`, `error` and `warning`
 *  are the CLI's own notices, and a reply with only tool calls has no text. */
async function conversation(context: AgentSessionContext): Promise<AgentConversationMessage[] | null> {
  const file = await locate(context)
  const record = file ? await readRecord(file) : null
  if (!record || !Array.isArray(record.messages)) return null
  return record.messages.flatMap((raw): AgentConversationMessage[] => {
    const message = object(raw)
    const role = message?.type === 'user' ? 'user' : message?.type === 'gemini' ? 'assistant' : null
    if (!message || !role) return []
    const text = (role === 'user' ? partsText(message.displayContent ?? message.content) : partsText(message.content)).trim()
    if (!text) return []
    const createdAt = isoTimestamp(message.timestamp)
    return [{ role, text, ...(createdAt ? { createdAt } : {}) }]
  })
}

const files = async (context: AgentSessionContext): Promise<string[]> => {
  const file = await locate(context)
  return file ? [file] : []
}

/**
 * Each `gemini` message carries its response's `tokens`: `input` includes
 * `cached`, `tool` is the tool-use prompt, and `thoughts` is NOT part of
 * `output` (total = input + output + thoughts + tool). Gemini records no cost.
 */
export function geminiUsageRecords(record: Record<string, unknown>, cwd: string | null, sinceMs = 0): AgentUsageRecord[] {
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  if (!sessionId || !Array.isArray(record.messages)) return []
  return record.messages.flatMap((raw): AgentUsageRecord[] => {
    const message = object(raw)
    const tokens = object(message?.tokens)
    const timestampMs = typeof message?.timestamp === 'string' ? Date.parse(message.timestamp) : NaN
    if (message?.type !== 'gemini' || !tokens || !(timestampMs >= sinceMs)) return []
    const thoughts = tokenCount(tokens.thoughts)
    const totals = totalsFromInclusiveInput(
      tokenCount(tokens.input) + tokenCount(tokens.tool), tokenCount(tokens.cached), 0,
      tokenCount(tokens.output) + thoughts, thoughts,
    )
    return [{
      timestampMs,
      model: typeof message.model === 'string' && message.model ? message.model : 'gemini',
      sessionId,
      cwd,
      totals,
      reportedCostUsd: null,
      dedupeKey: typeof message.id === 'string' ? `${sessionId}:${message.id}` : null,
    }]
  })
}

async function usageRecords(homeDir: string, sinceMs: number): Promise<AgentUsageRecord[] | null> {
  const root = tmpRoot(homeDir)
  let buckets
  try {
    buckets = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  const records: AgentUsageRecord[] = []
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue
    const dir = path.join(root, bucket.name)
    const cwd = (await readFile(path.join(dir, '.project_root'), 'utf8').catch(() => '')).trim() || null
    for (const name of await readdir(path.join(dir, 'chats')).catch(() => [])) {
      if (!name.startsWith('session-') || !name.endsWith('.json')) continue
      const file = path.join(dir, 'chats', name)
      // ponytail: whole-file parse of each session touched in the window; a scan cache if this shows up in profiles
      if (((await stat(file).catch(() => null))?.mtimeMs ?? 0) < sinceMs) continue
      const record = await readRecord(file)
      if (record) records.push(...geminiUsageRecords(record, cwd, sinceMs))
    }
  }
  return records
}

const geminiUsage: AgentUsage = {
  source: { kind: 'store', location: tmpRoot, records: usageRecords },
}

export const geminiSessionStore: AgentSessionStore = { title, conversation, files, usage: geminiUsage }
