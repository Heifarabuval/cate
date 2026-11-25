// `agence org` helper: reads <root>/.cate/org.json, validates it with the
// workspace org contract and prints the result as JSON. Exit 0 whether the
// file is valid or not; the caller reads `ok`. Bundled beside the agence CLI.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadOrg, ORG_FILE } from '@workspace/org/contract'

const root = process.argv[2] ?? process.cwd()
let text: string | undefined
try {
	text = readFileSync(path.join(root, ORG_FILE), 'utf-8')
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
		console.log(JSON.stringify({ ok: false, errors: [`${ORG_FILE}: ${(error as Error).message}`] }))
		process.exit(0)
	}
}
const result = loadOrg(text)
console.log(JSON.stringify(result.ok ? { ...result, agents: result.org.maxAgents } : result))
