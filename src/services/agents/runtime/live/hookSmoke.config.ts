import { AGENTS, type AgentId } from '../../contract'

/** Agents the live CI cannot run, each with its reason. Declared here once:
 *  the matrix completeness test reads it, and any other agent missing from
 *  scripts/agent-cli-matrix.json still fails that test. Their unit tests run. */
export const LIVE_CI_EXCLUSIONS: Partial<Record<AgentId, string>> = {
  antigravity: 'agy talks only to Google\'s backend with a signed-in Google account; no fake provider can reach it.',
}

/** Agents the matrix gets wrong: missing without a declared exclusion, or
 *  listed although excluded. Empty when the matrix is complete. */
export function liveMatrixGaps(matrix: readonly string[], ids: readonly AgentId[]): AgentId[] {
  return ids.filter((id) => matrix.includes(id) === id in LIVE_CI_EXCLUSIONS)
}

/** An explicit selection must never turn a misspelling into a green, empty run. */
export function selectHookSmokeAgents(selection?: string): AgentId[] {
  if (selection === undefined) return AGENTS.map((agent) => agent.id).filter((id) => !(id in LIVE_CI_EXCLUSIONS))
  const ids = selection.split(',').map((id) => id.trim())
  for (const id of ids) {
    if (!AGENTS.some((agent) => agent.id === id)) throw new Error(`Unknown hook smoke agent: ${JSON.stringify(id)}`)
  }
  return [...new Set(ids)] as AgentId[]
}

export function redactHookSmokeOutput(output: string, env: NodeJS.ProcessEnv): string {
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) output = output.replaceAll(value, '[REDACTED]')
  }
  return output
}
