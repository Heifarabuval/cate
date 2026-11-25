// What an org does on a typical task, without running an agent: the path of
// the task through roles and links, the defects to fix before use, and an
// estimated cost. Pure; the desktop view only draws it.

import type { OrgEffort, OrgFile } from './schema'

/** A role works, or the user is asked to click. A click is `before` the
 *  receiving role starts or `after` it finished. */
export type OrgEvent =
	| { kind: 'work'; wave: number; roles: string[] }
	| { kind: 'click'; wave: number; when: 'before' | 'after'; link: number }

export interface OrgPath {
	/** Roles per wave; the roles of a wave run at the same time. */
	waves: string[][]
	events: OrgEvent[]
}

export type OrgDefectKind = 'no-done' | 'no-validator' | 'shared-files' | 'over-cap' | 'over-memory'

export interface OrgDefect {
	kind: OrgDefectKind
	roles: string[]
	message: string
}

export interface OrgPreviewOptions {
	/** Files each role works on (folders or files); the org file does not hold them. */
	files?: Record<string, string[]>
	/** The machine's memory budget for agents, in GB. Unset: no memory check. */
	memoryCapGb?: number
	/** Estimated memory of one live agent, in GB. */
	agentMemoryGb?: number
}

export interface OrgCost {
	peakAgents: number
	memoryGb: number
	/** Tokens for one typical task, every role of the path counted once. */
	tokens: number
}

export interface OrgPreview {
	path: OrgPath
	defects: OrgDefect[]
	cost: OrgCost
}

// Estimates, not measures: one pass of a role at each effort.
export const TOKENS_PER_EFFORT: Record<OrgEffort, number> = {
	low: 20_000,
	medium: 60_000,
	high: 150_000,
	xhigh: 300_000,
	max: 500_000
}
export const DEFAULT_AGENT_MEMORY_GB = 2

/** Wave of a role = longest chain of links before it. Capped, so a cycle ends. */
function waveOf(org: OrgFile): Map<string, number> {
	const wave = new Map(Object.keys(org.roles).map((id) => [id, 0]))
	for (let i = 0; i < wave.size; i++) {
		for (const l of org.links) {
			const next = (wave.get(l.from) ?? 0) + 1
			if (next > (wave.get(l.to) ?? Infinity)) wave.set(l.to, next)
		}
	}
	return wave
}

export function orgPath(org: OrgFile): OrgPath {
	const wave = waveOf(org)
	const waves: string[][] = []
	for (const [id, w] of wave) (waves[w] ??= []).push(id)
	const events: OrgEvent[] = []
	waves.forEach((roles, w) => {
		const into = (when: 'before' | 'after') =>
			org.links.flatMap((l, link) => (l.click === when && wave.get(l.to) === w ? [{ kind: 'click' as const, wave: w, when, link }] : []))
		events.push(...into('before'), { kind: 'work', wave: w, roles }, ...into('after'))
	})
	return { waves, events }
}

/** Roles alive in a wave: its own plus the verifiers of the links that reach it. */
function alive(org: OrgFile, path: OrgPath): string[][] {
	const wave = new Map(path.waves.flatMap((roles, w) => roles.map((r) => [r, w] as const)))
	return path.waves.map((roles, w) => {
		const set = new Set(roles)
		for (const l of org.links) if (l.verifiedBy && wave.get(l.to) === w) set.add(l.verifiedBy)
		return [...set]
	})
}

const overlaps = (a: string, b: string) => {
	const x = a.replace(/\/+$/, '')
	const y = b.replace(/\/+$/, '')
	return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

export function orgCost(org: OrgFile, options: OrgPreviewOptions = {}): OrgCost {
	const roles = alive(org, orgPath(org))
	const peakAgents = Math.max(...roles.map((r) => r.length))
	const used = new Set(roles.flat())
	let tokens = 0
	for (const id of used) tokens += TOKENS_PER_EFFORT[org.roles[id].effort]
	return { peakAgents, memoryGb: peakAgents * (options.agentMemoryGb ?? DEFAULT_AGENT_MEMORY_GB), tokens }
}

export function orgDefects(org: OrgFile, options: OrgPreviewOptions = {}): OrgDefect[] {
	const defects: OrgDefect[] = []
	for (const [id, role] of Object.entries(org.roles))
		if (!role.done.trim()) defects.push({ kind: 'no-done', roles: [id], message: `${role.name} has no "done": nothing says when it is finished.` })
	org.links.forEach((l) => {
		if (!l.verifiedBy)
			defects.push({ kind: 'no-validator', roles: [l.from, l.to], message: `${org.roles[l.from]?.name ?? l.from} to ${org.roles[l.to]?.name ?? l.to} has no validator.` })
	})
	const withFiles = Object.entries(options.files ?? {})
	for (let i = 0; i < withFiles.length; i++)
		for (let j = i + 1; j < withFiles.length; j++) {
			const [a, filesA] = withFiles[i]
			const [b, filesB] = withFiles[j]
			if (filesA.some((x) => filesB.some((y) => overlaps(x, y))))
				defects.push({ kind: 'shared-files', roles: [a, b], message: `${a} and ${b} work on the same files.` })
		}
	const cost = orgCost(org, options)
	if (cost.peakAgents > org.maxAgents)
		defects.push({ kind: 'over-cap', roles: [], message: `${cost.peakAgents} roles work at once, the cap is ${org.maxAgents}.` })
	if (options.memoryCapGb !== undefined && cost.memoryGb > options.memoryCapGb)
		defects.push({ kind: 'over-memory', roles: [], message: `${cost.peakAgents} agents need about ${cost.memoryGb} GB, the machine allows ${options.memoryCapGb} GB.` })
	return defects
}

export function previewOrg(org: OrgFile, options: OrgPreviewOptions = {}): OrgPreview {
	return { path: orgPath(org), defects: orgDefects(org, options), cost: orgCost(org, options) }
}
