// Starting an agent (`cate.agent.start`): what the CLI runs in a terminal in
// place of the shell, and the agent CLIs a start can pick. Pure.

import { AGENT_DEFS, type AgentId } from './registry'

/** An agent CLI a start can pick (`cate.agent.types`). */
export interface AgentTypeInfo {
  agentId: AgentId
  displayName: string
  /** Its Cate hooks are on here, so it can start in a terminal. */
  ready: boolean
  /** Setup readiness on the runtime host, independent of workspace hooks. */
  setupReason?: string
}

const AGENT_TASK_PREFIX = 'Complete this coding task:\n\n'

/** The model and reasoning effort a start asks of the agent CLI; each is
 *  optional and independent. */
export interface AgentLaunchOptions {
  model?: string
  effort?: string
}

/** Why the agent cannot take these options (it declares no such option, or
 *  does not know the value), or null. A model id is free text, but never
 *  looks like an option itself. */
export function agentLaunchOptionsError(agentId: AgentId, { model, effort }: AgentLaunchOptions): string | null {
  const agent = AGENT_DEFS[agentId]
  if (model !== undefined) {
    if (!agent.launchOptions.model) return `${agent.displayName} has no model option`
    if (model.startsWith('-')) return 'model cannot start with "-"'
    if (model.includes('\0')) return 'model cannot contain NUL bytes'
  }
  if (effort !== undefined) {
    const known = agent.launchOptions.effort
    if (!known) return `${agent.displayName} has no effort option`
    if (!known.values.includes(effort)) return `${agent.displayName} does not know the effort "${effort}" (${known.values.join(', ')})`
  }
  return null
}

/**
 * The exact executable + argv of a started agent's PTY. No shell is involved,
 * so prompt text cannot become shell syntax, and prefixing the positional
 * prompt prevents option or subcommand injection into the CLI's argv parser.
 * Every executable comes from the registry; callers cannot provide a path or
 * flags (the model and effort options are the registry's, before the prompt).
 * Without a prompt the CLI opens its interactive session.
 */
export function agentLaunchCommand(launch: { agentId: AgentId; prompt?: string } & AgentLaunchOptions): { executable: string; args: string[] } {
  const agent = AGENT_DEFS[launch.agentId]
  if (!agent) throw new Error(`Unsupported agent: ${launch.agentId}`)
  const error = agentLaunchOptionsError(launch.agentId, launch)
  if (error) throw new Error(error)
  const options = [
    ...(launch.model !== undefined ? agent.launchOptions.model!(launch.model) : []),
    ...(launch.effort !== undefined ? agent.launchOptions.effort!.args(launch.effort) : []),
  ]
  if (launch.prompt === undefined) return { executable: agent.command, args: [...options, ...agent.startArgs] }
  const prompt = launch.prompt.trim()
  if (!prompt) throw new Error('A prompt is required')
  if (prompt.includes('\0')) throw new Error('Prompts cannot contain NUL bytes')
  return {
    executable: agent.command,
    args: [...options, ...agent.promptArgs(`${AGENT_TASK_PREFIX}${prompt}`)],
  }
}

/** A started agent's first prompt as the person wrote it, without the prefix
 *  its launch added (`agentLaunchCommand`). */
export function agentTaskText(text: string): string {
  return text.startsWith(AGENT_TASK_PREFIX) ? text.slice(AGENT_TASK_PREFIX.length) : text
}
