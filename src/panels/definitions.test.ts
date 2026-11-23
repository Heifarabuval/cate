import { expect, it } from 'vitest'
import { PANEL_TYPES } from '@workspace/document/contract'
import { definitionProblems } from './framework/contract'
import { PANEL_DEFINITIONS, creatableDefinitions, panelDefinition } from './definitions'

it('every panel definition meets the contract', () => {
  for (const definition of PANEL_DEFINITIONS) expect(definitionProblems(definition), definition.type).toEqual([])
})

it('lists each type once, and only document panel types', () => {
  const types = PANEL_DEFINITIONS.map((definition) => definition.type)
  expect(new Set(types).size).toBe(types.length)
  for (const type of types) expect(PANEL_TYPES).toContain(type)
  expect(panelDefinition('review')?.icon).toBe('git-compare')
})

it('declares the agence panel: an execution panel with no cate api', () => {
  const agence = panelDefinition('agence')
  expect(agence?.icon).toBe('briefcase')
  expect(agence?.relation?.execution).toBe(true)
  expect(agence?.api).toBeUndefined()
  expect(creatableDefinitions().map((definition) => definition.creation?.title ?? definition.label)).toContain('Start Agence')
  expect(PANEL_TYPES).toContain('agence')
})

it('declares the boite panel: a client view with no session and no cate api', async () => {
  const boite = panelDefinition('boite')
  expect(boite).toBeDefined()
  expect(boite?.api).toBeUndefined()
  expect(PANEL_TYPES).toContain('boite')
  const { PANEL_RUNTIMES } = await import('./runtime')
  // Services are read only by the entries that use them: any value serves here.
  const anything: unknown = new Proxy(() => {}, { get: () => anything, apply: () => anything })
  const entries = PANEL_RUNTIMES.map((runtime) => runtime(anything as never))
  const entry = entries.find((module) => module.definition.type === 'boite')
  expect(entry).toBeDefined()
  expect(entry?.session).toBeUndefined()
})

it('declares the app panel: one type for every custom panel, never listed in a creation menu', () => {
  const app = panelDefinition('app')
  expect(app?.label).toBe('Panneau perso')
  expect(app?.canLiveOnCanvas).toBe(true)
  expect(app?.creation).toBeUndefined()
  expect(app?.commands).toBeUndefined()
  expect(app?.fields?.({ appId: 'fusion-excel' })).toEqual({ appId: 'fusion-excel' })
  expect(creatableDefinitions().map((definition) => definition.type)).not.toContain('app')
  expect(PANEL_TYPES).toContain('app')
})
