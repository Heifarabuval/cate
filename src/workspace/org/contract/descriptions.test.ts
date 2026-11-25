import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrg } from './load'
import { previewOrg } from './preview'

// Each description is what a person says; the JSON is what the agent writes from it.
const read = (file: string) => readFileSync(path.join(__dirname, 'fixtures', file), 'utf-8')

describe('org written from a description', () => {
	it.each([
		['solo', 1],
		['esn', 7],
		['admin', 3]
	])('%s: the file is valid and previews without blocking defect', (name, roles) => {
		expect(read(`${name}.txt`).trim()).not.toBe('')
		const result = loadOrg(read(`${name}.json`))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(Object.keys(result.org.roles)).toHaveLength(roles)
		// A link without a validator is a warning of the preview, not an error of the file.
		expect(previewOrg(result.org).defects.filter((d) => d.kind !== 'no-validator')).toEqual([])
	})

	it('an absurd description gives a file the contract refuses', () => {
		const result = loadOrg(read('absurde.json'))
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors.join('\n')).toMatch(/maxAgents[\s\S]*roles/)
	})
})
