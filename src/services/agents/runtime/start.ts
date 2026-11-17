// Starting an agent (`cate.agent.start`): the hook-ready agent CLI for the
// checkout, run in place of a terminal panel's shell (a new panel, or an idle
// one the caller names), in the caller's checkout or a worktree, next to the
// caller unless told where. Once started it is an agent like any other:
// `cate.agent.*` talks to it by its panel. Panels and worktrees come
// through injected ports, since they live in other modules.

import { RpcError } from '@kernel/rpc/contract'
import type { Point } from '@workspace/canvas/contract'
import type { PlaceTarget, RelationKind } from '@workspace/document/contract'
import { AGENT_DEFS, AGENT_LAUNCH, AGENTS, agentLaunchOptionsError, isAgentId, isPromptAttachments, type AgentId, type AgentLaunchOptions, type AgentTypeInfo } from '../contract'
import type { AgentsCore } from './core'
import type { DoneWhen } from './doneWhen'
import { evaluateAgentCliHooks, inspectAgentCliHooks, resolveDriverAgent } from './hooks/readiness'

/** Where a new panel goes: an explicit target, or near a panel (on its
 *  canvas when it is a canvas panel or sits on one), at a canvas point. */
export interface AgentPlacement {
  at?: PlaceTarget
  near?: string
  position?: Point
}

/** A launch the terminal service resolves (a registered launch intent). */
export interface AgentTerminalLaunch {
  kind: string
  params: unknown
}

export interface AgentStartPorts {
  terminals: {
    /** A new terminal panel running `launch`; resolves once it is placed.
     *  The session owns asynchronous startup and reports any launch failure.
     *  `titleChosen`: the caller named it, so the agent never retitles it. */
    create(params: { cwd: string; worktreeId?: string; title: string; titleChosen?: boolean; launch: AgentTerminalLaunch; placement: AgentPlacement }): Promise<string>
    /** Restarts an existing terminal panel's PTY with `launch`. */
    relaunch(panelId: string, params: { cwd: string; worktreeId?: string; launch: AgentTerminalLaunch }): Promise<void>
    /** A terminal panel's PTY, or null for a panel that is no terminal. */
    state(panelId: string): { alive: boolean; busy: boolean; starting?: boolean } | null
  }
  worktrees: {
    create(name: string): Promise<{ id: string; path: string }>
    /** Removes a worktree this start created, when the start failed. */
    remove(worktreeId: string): Promise<void>
  }
  relations: {
    /** Relates two panels (`kind` absent: the pair's default) and returns
     *  the relation's id; throws what the relation rule refuses. */
    link(fromPanelId: string, toPanelId: string, kind?: RelationKind): string
  }
}

export interface AgentStartArgs {
  /** Absent: the agent's interactive session, waiting for its first prompt. */
  prompt?: string
  /** Files that go with the prompt (then the prompt may be empty). */
  attachments?: string[]
  agentId?: string
  title?: string
  worktreeId?: string
  newWorktree?: string
  /** Terminal: an existing idle terminal panel to run in instead of a new one. */
  terminalPanelId?: string
  /** Default: next to the calling panel. */
  placement?: AgentPlacement
  /** Relate this panel (default with `relation`: the caller) to the agent. */
  linkFrom?: string
  relation?: RelationKind
  /** Model and reasoning effort for the agent CLI (its declared options). */
  model?: string
  effort?: string
  /** A shell command whose exit 0 after a turn finishes the task (doneWhen.ts). */
  doneWhen?: string
}

/** The panel hosting a started agent; with a relation asked, its id or why
 *  it was refused (the agent is started either way). */
export interface AgentStarted {
  panelId: string
  agentId: AgentId
  relationId?: string
  relationError?: string
}

export interface AgentStarter {
  /** Starts an agent for `callerPanelId` (undefined for a client); answers
   *  with the panel that hosts it. */
  start(callerPanelId: string | undefined, args: AgentStartArgs): Promise<AgentStarted>
  /** Every agent CLI, in registry order. */
  types(): Promise<AgentTypeInfo[]>
  /** Started agents whose CLI has not been observed yet: until its first
   *  hook, a started panel is no agent panel to the terminal agents. */
  starting(): Array<{ panelId: string; agentId: AgentId }>
  /** The model and effort a panel's agent was started with, if any. */
  launchOptions(panelId: string): AgentLaunchOptions | undefined
  /** Drops the options of panels the document no longer has. */
  prune(): void
}

/** How long a started agent counts as starting before its CLI is observed. */
const START_GRACE_MS = 60_000

function fail(code: string): never {
  throw new RpcError('rejected', code)
}

/** Start arguments once validated. */
type StartRequest = Omit<AgentStartArgs, 'agentId'> & { agentId?: AgentId }

export function createAgentStarter(agents: AgentsCore, ports: AgentStartPorts, setup?: { types?(): Promise<AgentTypeInfo[]> }, doneWhen?: Pick<DoneWhen, 'watch'>): AgentStarter {
  const pending = new Map<string, { agentId: AgentId; at: number }>()
  /** What each started panel's agent was asked for; a reused terminal drops
   *  the previous agent's. In memory, like `pending`. */
  const options = new Map<string, AgentLaunchOptions>()
  /** Still starting: recent, its terminal running, its agent not observed. */
  const stillStarting = (panelId: string, at: number): boolean => {
    const terminal = ports.terminals.state(panelId)
    return Date.now() - at < START_GRACE_MS
      && (terminal?.alive === true || terminal?.starting === true)
      && (agents.panels.state(panelId)?.status ?? 'notRunning') === 'notRunning'
  }

  /** The checkout to run in: the asked worktree, else the caller's own. */
  const checkoutFor = (callerPanelId: string | undefined, worktreeId: string | undefined): { cwd: string; worktreeId?: string } => {
    if (worktreeId) {
      const cwd = agents.document.worktreePath(worktreeId)
      if (!cwd) fail('worktree-not-registered')
      return { cwd: cwd!, worktreeId }
    }
    const inherited = callerPanelId ? agents.document.panel(callerPanelId)?.worktreeId : undefined
    const cwd = inherited ? agents.document.worktreePath(inherited) : undefined
    return inherited && cwd && cwd !== agents.root ? { cwd, worktreeId: inherited } : { cwd: agents.root }
  }

  /** Refuses reusing a terminal that is the caller's own or is busy. */
  const checkTerminal = (panelId: string, callerPanelId: string | undefined): void => {
    if (panelId === callerPanelId) fail('agent-cannot-replace-caller-terminal')
    const terminal = ports.terminals.state(panelId)
    if (!terminal) fail('terminal-not-found')
    if (terminal!.starting || terminal!.alive && (agents.panels.state(panelId)?.present || terminal!.busy)) fail('terminal-busy')
  }

  /** The hook-ready agent for the checkout (strict for a preference). */
  const chooseAgent = async (agentId: AgentId | undefined, cwd: string): Promise<AgentId> => {
    try {
      const agent = await resolveDriverAgent((dir) => agents.hooks.inspectFolders(dir), cwd, agentId ?? '', {
        fallbackCwd: agents.root,
        hookConfig: agents.settings.agentHookInjection(),
      })
      return agent.id
    } catch (error) {
      return fail(error instanceof Error ? `agent-hooks-not-ready: ${error.message}` : 'agent-hooks-not-ready')
    }
  }

  return {
    async start(callerPanelId, input) {
      agents.trust.requireTrusted()
      const attachments = input.attachments?.length ? input.attachments : undefined
      if (attachments && !isPromptAttachments(attachments)) fail('invalid-attachments')
      const prompt = input.prompt?.trim() ?? (attachments ? '' : undefined)
      if (prompt === '' && !attachments) fail('prompt-required')
      if (prompt?.includes('\0')) fail('invalid-prompt')
      if (input.agentId !== undefined && !isAgentId(input.agentId)) fail('unsupported-agent')
      if (input.worktreeId && input.newWorktree) fail('choose-worktreeId-or-newWorktree')
      const doneWhenCommand = input.doneWhen?.trim()
      if (input.doneWhen !== undefined && !doneWhenCommand) fail('done-when-required')
      if (doneWhenCommand?.includes('\0')) fail('invalid-done-when')
      const model = input.model?.trim()
      const effort = input.effort?.trim()
      if (input.model !== undefined && !model) fail('model-required')
      if (input.effort !== undefined && !effort) fail('effort-required')
      const launchOptions: AgentLaunchOptions = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
      const args = input as StartRequest
      if (args.terminalPanelId) checkTerminal(args.terminalPanelId, callerPanelId)
      const placement = args.placement ?? (callerPanelId ? { near: callerPanelId } : {})
      const linkFrom = args.linkFrom ?? (args.relation ? callerPanelId : undefined)
      if (args.relation && !linkFrom) fail('link-from-required')

      // The agent is picked before any worktree exists, so a refused start
      // leaves none.
      const existing = args.newWorktree ? null : checkoutFor(callerPanelId, args.worktreeId)
      const agentId = await chooseAgent(args.agentId, existing?.cwd ?? agents.root)
      // Asked of the agent's own declaration, never of its type here.
      for (const option of ['model', 'effort'] as const) {
        const unsupported = agentLaunchOptionsError(agentId, { [option]: launchOptions[option] })
        if (unsupported) fail(`${option}-unsupported: ${unsupported}`)
      }

      const created = args.newWorktree ? await ports.worktrees.create(args.newWorktree) : null
      const checkout = created ? { cwd: created.path, worktreeId: created.id } : existing!
      /** The relation asked for; a refusal is told, not thrown: the agent
       *  already runs. */
      const link = (started: AgentStarted): AgentStarted => {
        if (!linkFrom) return started
        try {
          return { ...started, relationId: ports.relations.link(linkFrom, started.panelId, args.relation) }
        } catch (error) {
          return { ...started, relationError: error instanceof Error ? error.message : String(error) }
        }
      }
      const started = (panelId: string): AgentStarted => {
        pending.set(panelId, { agentId, at: Date.now() })
        // A reused terminal drops the condition of the agent it ran before.
        doneWhen?.watch(panelId, doneWhenCommand ? { command: doneWhenCommand, cwd: checkout.cwd, ...(callerPanelId ? { callerPanelId } : {}) } : null)
        if (Object.keys(launchOptions).length) options.set(panelId, launchOptions)
        else options.delete(panelId)
        return link({ panelId, agentId })
      }
      const launch = { kind: AGENT_LAUNCH.start, params: { agentId, ...(prompt !== undefined ? { prompt } : {}), ...(attachments ? { attachments } : {}), ...launchOptions } }
      try {
        if (args.terminalPanelId) {
          // Reuse the panel, not its shell process: restarting the PTY
          // launches the canonical executable and argv directly.
          await ports.terminals.relaunch(args.terminalPanelId, { ...checkout, launch })
          return started(args.terminalPanelId)
        }
        const chosen = args.title?.trim()
        const title = chosen || (prompt ? prompt.replace(/\s+/g, ' ').slice(0, 54) : AGENT_DEFS[agentId].displayName)
        return started(await ports.terminals.create({ ...checkout, title, ...(chosen ? { titleChosen: true } : {}), launch, placement }))
      } catch (error) {
        if (created) await ports.worktrees.remove(created.id).catch(() => {})
        throw error
      }
    },

    async types() {
      agents.trust.requireTrusted()
      if (setup?.types) return setup.types()
      const states = await inspectAgentCliHooks((dir) => agents.hooks.inspectFolders(dir), agents.root)
      const config = agents.settings.agentHookInjection()
      const ready = new Set(states.filter((state) => evaluateAgentCliHooks(state, config).ready).map((state) => state.agent.id))
      const types = AGENTS.map((agent) => ({ agentId: agent.id, displayName: agent.displayName, ready: ready.has(agent.id) }))
      return types
    },

    launchOptions: (panelId) => options.get(panelId),

    prune() {
      for (const panelId of [...options.keys()]) if (!agents.document.panel(panelId)) options.delete(panelId)
    },

    starting() {
      const out: Array<{ panelId: string; agentId: AgentId }> = []
      for (const [panelId, { agentId, at }] of pending) {
        if (stillStarting(panelId, at)) out.push({ panelId, agentId })
        else pending.delete(panelId)
      }
      return out
    },
  }
}
