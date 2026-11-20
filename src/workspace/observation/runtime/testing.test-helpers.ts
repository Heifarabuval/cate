// Test support of the observation runtime. A test that writes files writes
// them in a folder of the system temp dir, and fails when that folder is, or
// sits inside, the real `~/.cate`.

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatLogMessage, type Logger } from '@kernel/log/contract'
import { createDocument, type DocOp, type PanelRecord, type PanelRelation, type PanelType, type WorkspaceDocument } from '@workspace/document/contract'
import type { DocumentSource } from './sources'

export function tempDir(): { dir: string; remove(): void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cate-observation-'))
  const real = path.join(os.homedir(), '.cate')
  if (dir === real || dir.startsWith(`${real}${path.sep}`)) throw new Error(`a test must not touch the real ${real}`)
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A logger that keeps what was warned. */
export function recordingLog(): { log: Logger; warnings: string[] } {
  const warnings: string[] = []
  const log: Logger = {
    scope: 'test',
    debug() {},
    info() {},
    warn: (message, ...args) => { warnings.push(formatLogMessage(message, args)) },
    error() {},
    child: () => log,
  }
  return { log, warnings }
}

/** A clock a test moves: local time, like the file names of the journal. */
export function clock(...start: [year: number, month: number, day: number, hour?: number, minute?: number]) {
  const at = (year: number, month: number, day: number, hour = 0, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime()
  let now = at(...start)
  return {
    now: () => now,
    set: (...to: Parameters<typeof at>) => { now = at(...to) },
    advance: (ms: number) => { now += ms },
    at,
  }
}

/** Writes a file of the journal with a content and a modification time. */
export function writeDay(dir: string, name: string, content = '', mtimeMs?: number): string {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, content)
  if (mtimeMs !== undefined) utimesSync(file, mtimeMs / 1000, mtimeMs / 1000)
  return file
}

// ---- The document, as a source sees it -------------------------------------------

export const panel = (id: string, type: PanelType, title = 'Untitled'): PanelRecord => ({ id, type, title, fields: {} })
export const relation = (id: string, fromPanelId: string, toPanelId: string): PanelRelation => ({ id, fromPanelId, toPanelId, kind: 'context' })

export const doc = (panels: PanelRecord[], relations: PanelRelation[] = []): WorkspaceDocument => ({
  ...createDocument(),
  panels: Object.fromEntries(panels.map((record) => [record.id, record])),
  relations: Object.fromEntries(relations.map((one) => [one.id, one])),
})

/** An op as the document applied it: only its kind matters to a source. */
export const op = (change: Record<string, unknown>): DocOp => ({ opId: 'op', ...change }) as unknown as DocOp

/** A document that applies ops when the test says so. */
export function fakeDocument() {
  const listeners = new Set<(event: { op: DocOp; before: WorkspaceDocument; doc: WorkspaceDocument }) => void>()
  const source: DocumentSource = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    source,
    listeners: () => listeners.size,
    emit: (applied: DocOp, before: WorkspaceDocument, after: WorkspaceDocument) => listeners.forEach((listener) => listener({ op: applied, before, doc: after })),
  }
}
