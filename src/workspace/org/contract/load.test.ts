import { describe, expect, it } from 'vitest'
import { ORG_AGENCY, ORG_SOLO } from './examples'
import { loadOrg, ORG_FILE } from './load'

describe('loadOrg', () => {
	it('falls back to solo when there is no file', () => {
		expect(loadOrg(undefined)).toEqual({ ok: true, source: 'solo', org: ORG_SOLO })
	})

	it('reads the agency example from its text', () => {
		expect(loadOrg(JSON.stringify(ORG_AGENCY))).toEqual({ ok: true, source: ORG_FILE, org: ORG_AGENCY })
	})

	it('refuses text that is not JSON, without falling back to solo', () => {
		const result = loadOrg('{ nope')
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]).toMatch(/not valid JSON/)
	})

	it('refuses an invalid file with every error', () => {
		const bad = { ...ORG_AGENCY, maxAgents: 0, links: [{ from: 'po', to: 'ghost', click: 'now' }] }
		const result = loadOrg(JSON.stringify(bad))
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3)
	})
})
