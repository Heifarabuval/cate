import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_WINDOW, type JsonObject } from '@workspace/document/contract'
import type { AnyPanelDefinition } from '@panels/framework/contract'
import { add, attachTestWorkspace, buildDocument, testPanelDefinitions, type TestWorkspace } from '../../test/clientWorkspace'
import { registerPanelDefinitions } from './definitions'
import { openUrlBeside } from './openBeside'

// A terminal takes prompts and a browser takes part in relations, as the real
// definitions say; the browser's `url` option is its record's `url` field.
const withRelations = (relations: boolean): AnyPanelDefinition[] => testPanelDefinitions().map((definition) => {
  if (definition.type === 'browser') return { ...definition, ...(relations ? { relation: {} } : {}), fields: (options: { url?: string }): JsonObject => (options.url ? { url: options.url } : {}) }
  if (relations && definition.type === 'terminal') return { ...definition, relation: { execution: true } }
  return definition
})

const main = { windowId: MAIN_WINDOW }
const fixture = () => buildDocument([add('t1', { to: 'stack', dock: main, stackId: 's1' }, 'terminal')])

let workspace: TestWorkspace | null = null
afterEach(() => { workspace?.detach(); workspace = null })
const open = (relations = true) => {
  registerPanelDefinitions(withRelations(relations))
  workspace = attachTestWorkspace('ws', fixture())
  return workspace
}
const browsers = (w: TestWorkspace) => Object.values(w.document.getSnapshot().panels).filter((panel) => panel.type === 'browser')
const relations = (w: TestWorkspace) => Object.values(w.document.getSnapshot().relations)

beforeAll(() => registerPanelDefinitions(withRelations(true)))

describe('openUrlBeside', () => {
  it('opens the URL in a new browser panel next to the source, related to it as context', () => {
    const w = open()
    const id = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/8')
    expect(id).not.toBeNull()
    expect(browsers(w).map((panel) => [panel.id, panel.fields.url])).toEqual([[id, 'https://github.com/x/y/pull/8']])
    expect(relations(w)).toEqual([expect.objectContaining({ fromPanelId: 't1', toPanelId: id, kind: 'context' })])
  })

  it('reveals the browser already on that URL instead of opening another', () => {
    const w = open()
    const first = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/8')
    const again = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/8')
    expect(again).toBe(first)
    expect(browsers(w)).toHaveLength(1)
    expect(relations(w)).toHaveLength(1)
    expect(w.state.getSnapshot().focusedPanelId).toBe(first)
  })

  it('opens another browser for another URL', () => {
    const w = open()
    const first = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/8')
    const second = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/9')
    expect(second).not.toBe(first)
    expect(browsers(w)).toHaveLength(2)
  })

  it('still opens the page when the relation is refused (panels that take no part in relations)', () => {
    const w = open(false)
    const id = openUrlBeside('ws', 't1', 'https://github.com/x/y/pull/8')
    expect(id).not.toBeNull()
    expect(browsers(w)).toHaveLength(1)
    expect(relations(w)).toEqual([])
  })

  it('opens nothing for an unknown workspace', () => {
    open()
    expect(openUrlBeside('other', 't1', 'https://github.com/x/y/pull/8')).toBeNull()
  })
})
