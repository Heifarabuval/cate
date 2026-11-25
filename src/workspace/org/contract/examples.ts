import type { OrgFile, OrgRole } from './schema'

const dev: OrgRole = {
	name: 'Dev',
	mission: 'Implement the task on a branch and open a PR.',
	model: 'sonnet',
	effort: 'medium',
	tools: ['read', 'edit', 'bash'],
	done: 'PR opened'
}

/** The default: one agent does everything. */
export const ORG_SOLO: OrgFile = {
	version: 1,
	maxAgents: 1,
	roles: { dev },
	links: []
}

/** One agent builds, another checks. */
export const ORG_DUO: OrgFile = {
	version: 1,
	maxAgents: 2,
	roles: {
		dev,
		reviewer: {
			name: 'Reviewer',
			mission: 'Check the PR against the task and report what is wrong.',
			model: 'sonnet',
			effort: 'high',
			tools: ['read', 'bash'],
			done: 'Review written'
		}
	},
	links: [{ from: 'dev', to: 'reviewer', click: 'after' }]
}

/** A small agency: product owner, front and back devs, check, rights. */
export const ORG_AGENCY: OrgFile = {
	version: 1,
	maxAgents: 4,
	roles: {
		po: {
			name: 'PO',
			mission: 'Turn the request into tasks with an acceptance test.',
			model: 'sonnet',
			effort: 'medium',
			tools: ['read'],
			done: 'Tasks written'
		},
		front: { ...dev, name: 'Dev front', mission: 'Build the UI part of a task.' },
		back: { ...dev, name: 'Dev back', mission: 'Build the server part of a task.' },
		qa: {
			name: 'QA',
			mission: 'Run the checks and the user path, report failures.',
			model: 'sonnet',
			effort: 'high',
			tools: ['read', 'bash'],
			done: 'Checks green or failures listed'
		},
		gcp: {
			name: 'GCP rights',
			mission: 'Prepare the IAM change for the user to run.',
			model: 'sonnet',
			effort: 'high',
			tools: ['read'],
			done: 'Role verified'
		}
	},
	links: [
		{ from: 'po', to: 'front', click: 'before' },
		{ from: 'po', to: 'back', click: 'before' },
		{ from: 'front', to: 'qa', verifiedBy: 'qa', click: 'after' },
		{ from: 'back', to: 'qa', verifiedBy: 'qa', click: 'after' },
		{ from: 'po', to: 'gcp', click: 'before' }
	]
}
