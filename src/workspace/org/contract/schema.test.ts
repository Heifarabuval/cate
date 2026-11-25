import { describe, expect, it } from 'vitest'
import { ORG_AGENCY, ORG_DUO, ORG_SOLO } from './examples'
import { parseOrg } from './schema'

const clone = () => structuredClone(ORG_DUO) as any

function errorsOf(input: unknown): string {
	const r = parseOrg(input)
	if (r.ok) throw new Error('expected a refusal')
	return r.errors.join('\n')
}

describe('parseOrg', () => {
	it('accepts the three shipped examples', () => {
		for (const org of [ORG_SOLO, ORG_DUO, ORG_AGENCY]) expect(parseOrg(org)).toEqual({ ok: true, org })
	})

	it('accepts a file read from JSON', () => {
		expect(parseOrg(JSON.parse(JSON.stringify(ORG_AGENCY))).ok).toBe(true)
	})

	it('refuses a role without "done"', () => {
		const org = clone()
		delete org.roles.dev.done
		expect(errorsOf(org)).toContain('role "dev": "done" is required')
		org.roles.dev.done = '  '
		expect(errorsOf(org)).toContain('"done" is required')
	})

	it('refuses a link to an unknown role', () => {
		const org = clone()
		org.links[0].to = 'ghost'
		expect(errorsOf(org)).toContain('unknown role "ghost"')
		org.links[0].to = 'reviewer'
		org.links[0].verifiedBy = 'nobody'
		expect(errorsOf(org)).toContain('unknown role "nobody"')
	})

	it('refuses a loop between roles', () => {
		const org = clone()
		org.links.push({ from: 'reviewer', to: 'dev', click: 'never' })
		expect(errorsOf(org)).toContain('loop between roles: dev -> reviewer -> dev')
		expect(errorsOf({ ...org, links: [{ from: 'dev', to: 'dev', click: 'never' }] })).toContain('loop')
	})

	it.each(['merge', 'pushMain', 'sendAs', 'permissions'])('refuses the rights key "%s"', (key) => {
		const top = { ...clone(), [key]: true }
		expect(errorsOf(top)).toContain(`"${key}" sets rights`)
		const role = clone()
		role.roles.dev[key] = true
		expect(errorsOf(role)).toContain('sets rights')
		const link = clone()
		link.links[0][key] = true
		expect(errorsOf(link)).toContain('sets rights')
	})

	it('refuses a rights tool', () => {
		const org = clone()
		org.roles.dev.tools.push('merge')
		expect(errorsOf(org)).toContain('tool "merge" sets rights')
	})

	it('refuses other unknown keys, bad effort and a bad cap', () => {
		const org = { ...clone(), extra: 1, maxAgents: 0 }
		org.roles.dev.effort = 'huge'
		const text = errorsOf(org)
		expect(text).toContain('unknown key "extra"')
		expect(text).toContain('"maxAgents"')
		expect(text).toContain('"effort"')
	})

	it('refuses a non-object file', () => {
		expect(errorsOf(null)).toContain('must be an object')
	})
})
