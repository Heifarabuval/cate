// The org file: who works in a workspace and how work flows. Hand-written
// JSON, validated on read. It never sets rights (merge, push to main, sending
// in the user's name): those stay with the user's click.

export const ORG_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type OrgEffort = (typeof ORG_EFFORTS)[number]

export const ORG_CLICKS = ['never', 'before', 'after'] as const
export type OrgClick = (typeof ORG_CLICKS)[number]

export interface OrgRole {
	name: string
	mission: string
	model: string
	effort: OrgEffort
	/** Tools the role may use. */
	tools: string[]
	/** What proves the role is finished (a PR opened, a role verified, a file exported). */
	done: string
}

export interface OrgLink {
	/** Role that hands work over. */
	from: string
	/** Role that receives it. */
	to: string
	/** Role that checks the result, if any. */
	verifiedBy?: string
	/** When the user's click is asked: before the work, after it, or never. */
	click: OrgClick
}

export interface OrgFile {
	version: 1
	/** Agents alive at once, at most. */
	maxAgents: number
	roles: Record<string, OrgRole>
	links: OrgLink[]
}

export type OrgResult = { ok: true; org: OrgFile } | { ok: false; errors: string[] }

const RIGHTS = /merge|push|send|permission|right|droit|grant/i
const ROLE_KEYS = ['name', 'mission', 'model', 'effort', 'tools', 'done']
const LINK_KEYS = ['from', 'to', 'verifiedBy', 'click']
const FILE_KEYS = ['version', 'maxAgents', 'roles', 'links']

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function unknownKeys(obj: Record<string, unknown>, known: string[], where: string, errors: string[]) {
	for (const key of Object.keys(obj)) {
		if (known.includes(key)) continue
		errors.push(
			RIGHTS.test(key)
				? `${where}: "${key}" sets rights; the org file never does (merge, push to main and sending stay with the user's click)`
				: `${where}: unknown key "${key}"`
		)
	}
}

function parseRole(id: string, raw: unknown, errors: string[]) {
	const where = `role "${id}"`
	if (!isObject(raw)) return void errors.push(`${where}: must be an object`)
	unknownKeys(raw, ROLE_KEYS, where, errors)
	for (const key of ['name', 'mission', 'model'] as const) {
		if (!isText(raw[key])) errors.push(`${where}: "${key}" is required`)
	}
	if (!isText(raw.done)) errors.push(`${where}: "done" is required (what proves the role is finished)`)
	if (!ORG_EFFORTS.includes(raw.effort as OrgEffort))
		errors.push(`${where}: "effort" must be one of ${ORG_EFFORTS.join(', ')}`)
	if (!Array.isArray(raw.tools) || !raw.tools.every(isText)) {
		errors.push(`${where}: "tools" must be a list of names`)
	} else {
		for (const tool of raw.tools)
			if (RIGHTS.test(tool)) errors.push(`${where}: tool "${tool}" sets rights; the org file never does`)
	}
}

/** First cycle found in the from -> to graph, as a role path, or undefined. */
function findCycle(links: OrgLink[]): string[] | undefined {
	const next = new Map<string, string[]>()
	for (const l of links) next.set(l.from, [...(next.get(l.from) ?? []), l.to])
	const state = new Map<string, 1 | 2>()
	const path: string[] = []
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === 2) return undefined
		if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id]
		state.set(id, 1)
		path.push(id)
		for (const to of next.get(id) ?? []) {
			const cycle = visit(to)
			if (cycle) return cycle
		}
		path.pop()
		state.set(id, 2)
		return undefined
	}
	for (const id of next.keys()) {
		const cycle = visit(id)
		if (cycle) return cycle
	}
	return undefined
}

/** Validate a parsed org file; every problem is reported, not just the first. */
export function parseOrg(input: unknown): OrgResult {
	const errors: string[] = []
	if (!isObject(input)) return { ok: false, errors: ['the org file must be an object'] }
	unknownKeys(input, FILE_KEYS, 'org file', errors)
	if (input.version !== 1) errors.push('"version" must be 1')
	if (!Number.isInteger(input.maxAgents) || (input.maxAgents as number) < 1)
		errors.push('"maxAgents" must be an integer of at least 1')

	const roles = isObject(input.roles) ? input.roles : undefined
	if (!roles || Object.keys(roles).length === 0) errors.push('"roles" needs at least one role')
	for (const [id, raw] of Object.entries(roles ?? {})) parseRole(id, raw, errors)

	const links: OrgLink[] = []
	if (!Array.isArray(input.links)) errors.push('"links" must be a list')
	else {
		input.links.forEach((raw, i) => {
			const where = `link ${i + 1}`
			if (!isObject(raw)) return void errors.push(`${where}: must be an object`)
			unknownKeys(raw, LINK_KEYS, where, errors)
			if (!ORG_CLICKS.includes(raw.click as OrgClick))
				errors.push(`${where}: "click" must be one of ${ORG_CLICKS.join(', ')}`)
			for (const key of ['from', 'to', 'verifiedBy'] as const) {
				const value = raw[key]
				if (value === undefined && key === 'verifiedBy') continue
				if (!isText(value) || !roles || !(value in roles))
					errors.push(`${where}: "${key}" points to unknown role "${String(value)}"`)
			}
			links.push(raw as unknown as OrgLink)
		})
		const cycle = findCycle(links)
		if (cycle) errors.push(`links loop between roles: ${cycle.join(' -> ')}`)
	}

	return errors.length ? { ok: false, errors } : { ok: true, org: input as unknown as OrgFile }
}
