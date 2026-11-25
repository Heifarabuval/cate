import { ORG_SOLO } from './examples'
import { parseOrg, type OrgFile } from './schema'

/** Where the org file lives, relative to the workspace root. Shared with the repo. */
export const ORG_FILE = '.cate/org.json'

export type LoadedOrg = { ok: true; source: 'solo' | typeof ORG_FILE; org: OrgFile } | { ok: false; errors: string[] }

/** The workspace's org from the file text; no file (undefined) is the solo profile, a bad file is never replaced by it. */
export function loadOrg(text: string | undefined): LoadedOrg {
	if (text === undefined) return { ok: true, source: 'solo', org: ORG_SOLO }
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		return { ok: false, errors: [`${ORG_FILE} is not valid JSON: ${(error as Error).message}`] }
	}
	const result = parseOrg(parsed)
	return result.ok ? { ok: true, source: ORG_FILE, org: result.org } : result
}
