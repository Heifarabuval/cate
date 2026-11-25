import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CapabilityImpl } from '@kernel/rpc/runtime'
import { loadOrg, ORG_FILE, type LoadedOrg, type orgCapability } from '../contract'

export interface OrgDeps {
	root: string
}

export async function readOrg({ root }: OrgDeps): Promise<LoadedOrg> {
	try {
		return loadOrg(await readFile(path.join(root, ORG_FILE), 'utf-8'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return loadOrg(undefined)
		return { ok: false, errors: [`${ORG_FILE}: ${(error as Error).message}`] }
	}
}

export function orgCapabilityImpl(deps: OrgDeps): CapabilityImpl<typeof orgCapability> {
	return { load: () => readOrg(deps) }
}
