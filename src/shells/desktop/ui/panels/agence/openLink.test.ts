import { beforeEach, expect, it, vi } from 'vitest'
import { createDocument, type PanelRecord, type WorkspaceDocument } from '@workspace/document/contract'

const h = vi.hoisted(() => ({
  doc: null as unknown as WorkspaceDocument,
  createPanel: vi.fn(),
  revealPanel: vi.fn(async () => true),
  addRelation: vi.fn(() => 'rel-1'),
}))
vi.mock('@client/host', () => ({ createPanel: h.createPanel, revealPanel: h.revealPanel }))
vi.mock('@client/document', () => ({ documentStoreFor: () => ({ getSnapshot: () => h.doc }) }))
vi.mock('../../workspace/relations', () => ({ addRelation: h.addRelation }))
import { openInCate } from './openLink'

const browser = (id: string, url: string): PanelRecord => ({ id, type: 'browser', title: 'Browser', fields: { url } })

beforeEach(() => {
  vi.clearAllMocks()
  h.doc = { ...createDocument(), panels: { ag1: { id: 'ag1', type: 'agence', title: 'Agence', fields: {} } } }
  h.createPanel.mockReturnValue('b1')
})

it('opens a link in a new Cate browser panel next to the agence panel, related to it as context', () => {
  expect(openInCate('ws', 'ag1', 'https://github.com/x/y/pull/8')).toBe('b1')
  expect(h.createPanel).toHaveBeenCalledWith('ws', 'browser', { url: 'https://github.com/x/y/pull/8', near: 'ag1' })
  expect(h.addRelation).toHaveBeenCalledWith('ws', 'ag1', 'b1', 'context')
  expect(h.revealPanel).toHaveBeenCalledWith('ws', 'b1')
})

it('reveals the browser panel already open on that link instead of opening another', () => {
  h.doc.panels.b1 = browser('b1', 'https://github.com/x/y/pull/8')
  h.doc.panels.b2 = browser('b2', 'https://github.com/x/y/pull/9')
  expect(openInCate('ws', 'ag1', 'https://github.com/x/y/pull/8')).toBe('b1')
  expect(h.createPanel).not.toHaveBeenCalled()
  expect(h.addRelation).not.toHaveBeenCalled()
  expect(h.revealPanel).toHaveBeenCalledWith('ws', 'b1')
})

it('opens nothing more when the panel cannot be placed', () => {
  h.createPanel.mockReturnValue(null)
  expect(openInCate('ws', 'ag1', 'https://github.com/x/y/pull/8')).toBeNull()
  expect(h.addRelation).not.toHaveBeenCalled()
  expect(h.revealPanel).not.toHaveBeenCalled()
})

it('asks for a relation the document accepts: agence and browser both take part in relations', async () => {
  const { newRelationProblem } = await import('@workspace/relations/contract')
  const { panelDefinition } = await import('@panels/definitions')
  h.doc.panels.b1 = browser('b1', 'https://github.com/x/y/pull/8')
  expect(newRelationProblem(h.doc, (type) => panelDefinition(type)?.relation, 'ag1', 'b1')).toBeNull()
})
