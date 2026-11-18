import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiHandlerContext } from '@kernel/api/contract'
import { MAIN_WINDOW } from '../contract'
import { createDocumentApiHandlers } from './api'
import { createDocumentService } from './index'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cate-document-api-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function setup() {
  const document = createDocumentService({ file: path.join(dir, 'document.json') })
  for (const id of ['term-a', 'term-b']) {
    document.apply({
      kind: 'addPanel',
      record: { id, type: 'terminal', title: id, fields: {} },
      at: { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's0' },
    })
  }
  const handlers = createDocumentApiHandlers({
    document,
    presence: { activePanelId: () => 'term-b' },
    checkRemoval: () => {},
    createPanel: () => null,
    relationKinds: () => [],
  }).panel
  const ctx = (panelId?: string, selected?: string): ApiHandlerContext => {
    let sticky = selected
    return {
      caller: { kind: 'cli', id: 'tok', ...(panelId ? { panelId } : {}) },
      method: 'panel.list',
      signal: new AbortController().signal,
      sticky: { get: () => sticky, set: (id) => { sticky = id }, clear: () => { sticky = undefined } },
    }
  }
  return { handlers, ctx, document }
}

describe('panel list caller', () => {
  it('marks only the calling panel', () => {
    const { handlers, ctx } = setup()
    const rows = handlers.list({}, ctx('term-a')) as Array<{ panelId: string; caller: boolean }>
    expect(rows.map((r) => [r.panelId, r.caller])).toEqual([['term-a', true], ['term-b', false]])
  })

  it('marks nobody for a caller outside a panel (a client)', () => {
    const { handlers, ctx } = setup()
    const rows = handlers.list({}, ctx()) as Array<{ caller: boolean }>
    expect(rows.every((r) => r.caller === false)).toBe(true)
  })
})
