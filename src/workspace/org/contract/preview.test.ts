import { describe, expect, it } from 'vitest'
import { ORG_AGENCY, ORG_DUO, ORG_SOLO } from './examples'
import { capacityOptions, orgCost, orgDefects, orgPath, previewOrg } from './preview'
import type { OrgFile } from './schema'

describe('orgPath', () => {
	it('runs a lone role as one wave without click', () => {
		const path = orgPath(ORG_SOLO)
		expect(path.waves).toEqual([['dev']])
		expect(path.events).toEqual([{ kind: 'work', wave: 0, roles: ['dev'] }])
	})

	it('puts a click after the receiving role', () => {
		expect(orgPath(ORG_DUO).events).toEqual([
			{ kind: 'work', wave: 0, roles: ['dev'] },
			{ kind: 'work', wave: 1, roles: ['reviewer'] },
			{ kind: 'click', wave: 1, when: 'after', link: 0 }
		])
	})

	it('runs the agency in three waves with clicks before and after', () => {
		const path = orgPath(ORG_AGENCY)
		expect(path.waves).toEqual([['po'], ['front', 'back', 'gcp'], ['qa']])
		const clicks = path.events.filter((e) => e.kind === 'click')
		expect(clicks.map((c) => [c.wave, c.when])).toEqual([
			[1, 'before'],
			[1, 'before'],
			[1, 'before'],
			[2, 'after'],
			[2, 'after']
		])
	})

	it('does not loop on a cycle', () => {
		const org: OrgFile = {
			...ORG_DUO,
			links: [
				{ from: 'dev', to: 'reviewer', click: 'never' },
				{ from: 'reviewer', to: 'dev', click: 'never' }
			]
		}
		expect(orgPath(org).waves.flat().sort()).toEqual(['dev', 'reviewer'])
	})
})

describe('orgDefects', () => {
	it('finds nothing in solo and duo', () => {
		expect(orgDefects(ORG_SOLO)).toEqual([])
		expect(orgDefects(ORG_DUO).map((d) => d.kind)).toEqual(['no-validator'])
	})

	it('flags a role without done', () => {
		const org: OrgFile = { ...ORG_SOLO, roles: { dev: { ...ORG_SOLO.roles.dev, done: ' ' } } }
		expect(orgDefects(org)).toEqual([{ kind: 'no-done', roles: ['dev'], message: expect.any(String) }])
	})

	it('flags links without validator, one per link', () => {
		const kinds = orgDefects(ORG_AGENCY).filter((d) => d.kind === 'no-validator')
		expect(kinds).toHaveLength(3)
	})

	it('flags two roles on the same files', () => {
		const defects = orgDefects(ORG_AGENCY, { files: { front: ['src/app'], back: ['src/app/api'] } })
		expect(defects.find((d) => d.kind === 'shared-files')?.roles).toEqual(['front', 'back'])
		expect(orgDefects(ORG_AGENCY, { files: { front: ['src/ui'], back: ['src/api'] } }).some((d) => d.kind === 'shared-files')).toBe(false)
	})

	it('flags more simultaneous roles than maxAgents', () => {
		const org: OrgFile = { ...ORG_AGENCY, maxAgents: 2 }
		expect(orgDefects(org).some((d) => d.kind === 'over-cap')).toBe(true)
		expect(orgDefects(ORG_AGENCY).some((d) => d.kind === 'over-cap')).toBe(false)
	})

	it('flags a peak above the memory cap', () => {
		const opts = { agentMemoryGb: 2, memoryCapGb: 4 }
		expect(orgDefects(ORG_AGENCY, opts).some((d) => d.kind === 'over-memory')).toBe(true)
		expect(orgDefects(ORG_AGENCY, { ...opts, memoryCapGb: 6 }).some((d) => d.kind === 'over-memory')).toBe(false)
		expect(orgDefects(ORG_AGENCY).some((d) => d.kind === 'over-memory')).toBe(false)
	})
})

describe('orgCost', () => {
	it('costs solo as one agent', () => {
		expect(orgCost(ORG_SOLO, { agentMemoryGb: 2 })).toMatchObject({ peakAgents: 1, memoryGb: 2, tokens: 60_000 })
	})

	it('counts the agency peak and the tokens of every role of the path', () => {
		const cost = orgCost(ORG_AGENCY, { agentMemoryGb: 2 })
		expect(cost.peakAgents).toBe(3)
		expect(cost.memoryGb).toBe(6)
		// po medium + front medium + back medium + gcp high + qa high
		expect(cost.tokens).toBe(60_000 * 3 + 150_000 * 2)
	})

	it('adds a verifier that is not the receiving role', () => {
		const org: OrgFile = { ...ORG_DUO, links: [{ from: 'dev', to: 'dev2', verifiedBy: 'reviewer', click: 'never' }], roles: { ...ORG_DUO.roles, dev2: ORG_DUO.roles.dev } }
		expect(orgCost(org).peakAgents).toBe(2)
	})
})

describe('previewOrg', () => {
	it('bundles path, defects and cost', () => {
		const preview = previewOrg(ORG_SOLO)
		expect(Object.keys(preview).sort()).toEqual(['cost', 'defects', 'path'])
	})
})

describe('capacityOptions', () => {
	it('turns the machine ceiling into the memory cap, measured per agent', () => {
		const options = capacityOptions({ ceiling: 3, avgAgentMb: 1536 })
		expect(options).toEqual({ memoryCapGb: 4.5, agentMemoryGb: 1.5 })
		expect(orgDefects(ORG_AGENCY, options).some((d) => d.kind === 'over-memory')).toBe(false)
		expect(orgDefects(ORG_AGENCY, capacityOptions({ ceiling: 1, avgAgentMb: 1536 })).some((d) => d.kind === 'over-memory')).toBe(true)
	})
})
