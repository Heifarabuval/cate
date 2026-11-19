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
  expect(creatableDefinitions().map((definition) => definition.creation?.title ?? definition.label)).toContain('New Orchestrator')
  expect(PANEL_TYPES).toContain('agence')
})
