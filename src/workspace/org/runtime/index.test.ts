import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ORG_FILE } from '../contract'
import { readOrg } from './index'

const rootWith = async (text?: string) => {
	const root = await mkdtemp(path.join(tmpdir(), 'org-'))
	if (text !== undefined) {
		await mkdir(path.join(root, '.cate'))
		await writeFile(path.join(root, ORG_FILE), text)
	}
	return root
}

it('gives the solo profile when the file is absent', async () => {
	const result = await readOrg({ root: await rootWith() })
	expect(result).toMatchObject({ ok: true, source: 'solo' })
})

it('reads the workspace file', async () => {
	const text = JSON.stringify({ version: 1, maxAgents: 2, roles: { dev: { name: 'Dev', mission: 'm', model: 'sonnet', effort: 'low', tools: [], done: 'PR' } }, links: [] })
	const result = await readOrg({ root: await rootWith(text) })
	expect(result.ok ? result.source : result.errors).toBe(ORG_FILE)
})

it('returns readable errors for an invalid file, never the solo profile', async () => {
	const result = await readOrg({ root: await rootWith('{nope') })
	expect(result).toMatchObject({ ok: false })
	expect(!result.ok && result.errors[0]).toContain('not valid JSON')
})
