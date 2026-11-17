import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcError, isRpcError } from '@kernel/rpc/contract'
import type { PanelRecord } from '@workspace/document/contract'
import type { AgentHookConfig } from '../contract'
import { createAgentsCore, type AgentsCore } from './core'
import { createAgentStarter, type AgentStartPorts } from './start'


let root: string
let agents: AgentsCore
let hookConfig: AgentHookConfig
let ports: {
  terminals: { create: ReturnType<typeof vi.fn>; relaunch: ReturnType<typeof vi.fn>; state: ReturnType<typeof vi.fn> }
  worktrees: { create: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  relations: { link: ReturnType<typeof vi.fn> }
}

const panels: PanelRecord[] = [
  { id: 'supervisor', type: 'terminal', title: 'Lead', worktreeId: 'wt-lead', fields: {} },
  { id: 'idle', type: 'terminal', title: 'Idle', fields: {} },
]
const worktrees: Record<string, string> = { 'wt-lead': '/repo/.cate/worktrees/lead' }

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'cate-agent-start-'))
  hookConfig = { codex: 'on' }
  agents = createAgentsCore({
    root,
    agentsDir: path.join(root, '.agents-data'),
    trust: { isTrusted: () => true, requireTrusted: () => {} },
    settings: { agentHookInjection: () => hookConfig, panelRelationsEnabled: () => true, usagePriceOverrides: () => ({}) },
    relationRole: () => undefined,
    document: {
      panel: (id) => panels.find((panel) => panel.id === id),
      panels: () => panels,
      relations: () => [],
      worktreePath: (id) => worktrees[id],
      setRelationContextMode: () => {},
      setTitleFromAgent: () => {},
      onChange: () => () => {},
    },
    resolveCheckout: async (cwd) => cwd ?? root,
    snapshot: async () => ({ nameByPid: new Map(), childrenByPid: new Map() }),
    notify: () => {},
  }, () => ({
    state: () => null,
    panelIds: () => [],
    onChange: () => () => {},
    send: async () => ({ ok: true }),
    interrupt: async () => ({ ok: true }),
    conversation: async () => null,
    conversationStamp: async () => null,
    onStep: () => () => {},
    onConversationReset: () => () => {},
    onTurnEnd: () => () => {},
    dispose: () => {},
  }))
  ports = {
    terminals: {
      create: vi.fn(async () => 'new-terminal'),
      relaunch: vi.fn(async () => {}),
      state: vi.fn((panelId: string) => (panelId === 'idle' ? { alive: true, busy: false } : null)),
    },
    worktrees: { create: vi.fn(async (name: string) => ({ id: `wt-${name}`, path: `/repo/.cate/worktrees/${name}` })), remove: vi.fn(async () => {}) },
    relations: { link: vi.fn(() => 'rel-1') },
  }
})

afterEach(() => {
  agents.dispose()
  rmSync(root, { recursive: true, force: true })
})

const starter = () => createAgentStarter(agents, ports as unknown as AgentStartPorts)

async function refusal(promise: Promise<unknown>): Promise<string> {
  try { await promise } catch (error) {
    expect(isRpcError(error)).toBe(true)
    return (error as Error).message
  }
  throw new Error('expected a refusal')
}

describe('agent start', () => {
  it('launches the selected CLI without waiting for account or installation inspection', async () => {
    const types = vi.fn(() => new Promise<never>(() => {}))
    const direct = createAgentStarter(agents, ports as unknown as AgentStartPorts, { types })
    await expect(direct.start(undefined, { agentId: 'codex' })).resolves.toEqual({ panelId: 'new-terminal', agentId: 'codex' })
    expect(types).not.toHaveBeenCalled()
    expect(ports.terminals.create).toHaveBeenCalledOnce()
  })
  it('runs a hook-ready CLI in a terminal next to the caller, in its checkout', async () => {
    await expect(starter().start('supervisor', { prompt: '  Fix the login  ' })).resolves.toEqual({ panelId: 'new-terminal', agentId: 'codex' })
    expect(ports.terminals.create).toHaveBeenCalledWith({
      cwd: '/repo/.cate/worktrees/lead',
      worktreeId: 'wt-lead',
      title: 'Fix the login',
      launch: { kind: 'agents.start', params: { agentId: 'codex', prompt: 'Fix the login' } },
      placement: { near: 'supervisor' },
    })
  })

  it('opens the interactive session at a picked spot without a prompt, titled by the agent', async () => {
    const placement = { at: { to: 'canvas', canvasId: 'c', nodeId: 'n', stackId: 's', rect: { origin: { x: 0, y: 0 }, size: { width: 640, height: 400 } } } } as const
    await starter().start(undefined, { agentId: 'codex', placement })
    expect(ports.terminals.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Codex',
      launch: { kind: 'agents.start', params: { agentId: 'codex' } },
      placement,
    }))
  })

  it('marks a title the caller chose, so the agent never retitles the panel', async () => {
    await starter().start('supervisor', { prompt: 'Fix the login', title: '  Alpha ' })
    expect(ports.terminals.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Alpha', titleChosen: true }))
  })

  it('counts a started agent as starting until its terminal stops or its CLI is observed', async () => {
    const agentStarter = starter()
    ports.terminals.state.mockReturnValue({ alive: true, busy: true })
    await agentStarter.start('supervisor', { prompt: 'Fix it' })
    expect(agentStarter.starting()).toEqual([{ panelId: 'new-terminal', agentId: 'codex' }])
    ports.terminals.state.mockReturnValue({ alive: false, busy: false, starting: true })
    expect(agentStarter.starting()).toEqual([{ panelId: 'new-terminal', agentId: 'codex' }])
    ports.terminals.state.mockReturnValue({ alive: false, busy: false })
    expect(agentStarter.starting()).toEqual([])
  })

  it('runs a client\'s start in a new worktree where it asks', async () => {
    const placement = { near: 'canvas', position: { x: 1, y: 2 } }
    await starter().start(undefined, { prompt: 'Fix it', agentId: 'codex', newWorktree: 'fix', placement })
    expect(ports.worktrees.create).toHaveBeenCalledWith('fix')
    expect(ports.terminals.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo/.cate/worktrees/fix', worktreeId: 'wt-fix', placement }))
  })

  it('links nothing unless asked', async () => {
    await starter().start('supervisor', { prompt: 'Fix it' })
    expect(ports.relations.link).not.toHaveBeenCalled()
  })

  it('links the caller, or the panel it names, to the new agent', async () => {
    await expect(starter().start('supervisor', { prompt: 'Fix it', relation: 'trigger' }))
      .resolves.toEqual({ panelId: 'new-terminal', agentId: 'codex', relationId: 'rel-1' })
    expect(ports.relations.link).toHaveBeenLastCalledWith('supervisor', 'new-terminal', 'trigger')
    await starter().start('supervisor', { prompt: 'Fix it', linkFrom: 'idle' })
    expect(ports.relations.link).toHaveBeenLastCalledWith('idle', 'new-terminal', undefined)
  })

  it('relates the new agent and watches its done-when condition in the same start', async () => {
    const watch = vi.fn()
    const both = createAgentStarter(agents, ports as unknown as AgentStartPorts, undefined, { watch })
    await expect(both.start('supervisor', { prompt: 'Fix it', relation: 'trigger', doneWhen: ' npm test ' }))
      .resolves.toEqual({ panelId: 'new-terminal', agentId: 'codex', relationId: 'rel-1' })
    expect(ports.relations.link).toHaveBeenLastCalledWith('supervisor', 'new-terminal', 'trigger')
    expect(watch).toHaveBeenCalledWith('new-terminal', { command: 'npm test', cwd: '/repo/.cate/worktrees/lead', callerPanelId: 'supervisor' })
  })

  it('keeps the started agent when the relation is refused, and says why', async () => {
    ports.relations.link.mockImplementation(() => { throw new RpcError('rejected', 'the relation would close a cycle') })
    await expect(starter().start('supervisor', { prompt: 'Fix it', relation: 'verify' }))
      .resolves.toEqual({ panelId: 'new-terminal', agentId: 'codex', relationError: 'the relation would close a cycle' })
  })

  it('refuses a relation with no panel to link from', async () => {
    expect(await refusal(starter().start(undefined, { prompt: 'Fix it', agentId: 'codex', relation: 'trigger' }))).toBe('link-from-required')
    expect(ports.terminals.create).not.toHaveBeenCalled()
  })

  it('removes the worktree it created when the panel cannot start', async () => {
    ports.terminals.create.mockRejectedValueOnce(new Error('could not place the terminal'))
    await expect(starter().start(undefined, { prompt: 'Fix it', newWorktree: 'fix' })).rejects.toThrow('could not place the terminal')
    expect(ports.worktrees.remove).toHaveBeenCalledWith('wt-fix')
  })

  it('fails when relaunching the reused terminal fails', async () => {
    ports.terminals.relaunch.mockRejectedValueOnce(new Error('spawn failed'))
    await expect(starter().start(undefined, { prompt: 'Fix it', terminalPanelId: 'idle' })).rejects.toThrow('spawn failed')
  })

  it('refuses before creating anything when the CLI cannot start', async () => {
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', agentId: 'kiro', newWorktree: 'fix' }))).resolves.toMatch(/^agent-hooks-not-ready/)
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', agentId: 'nope' }))).resolves.toBe('unsupported-agent')
    await expect(refusal(starter().start(undefined, { prompt: '   ' }))).resolves.toBe('prompt-required')
    expect(ports.worktrees.create).not.toHaveBeenCalled()
    expect(ports.terminals.create).not.toHaveBeenCalled()
  })

  it('relates and watches the done-when condition of an agent started in an existing terminal', async () => {
    const watch = vi.fn()
    const reused = createAgentStarter(agents, ports as unknown as AgentStartPorts, undefined, { watch })
    await expect(reused.start('supervisor', { prompt: 'Review', terminalPanelId: 'idle', relation: 'trigger', doneWhen: 'npm test' }))
      .resolves.toEqual({ panelId: 'idle', agentId: 'codex', relationId: 'rel-1' })
    expect(ports.terminals.relaunch).toHaveBeenCalledWith('idle', expect.objectContaining({ cwd: '/repo/.cate/worktrees/lead' }))
    expect(ports.terminals.create).not.toHaveBeenCalled()
    expect(ports.relations.link).toHaveBeenCalledWith('supervisor', 'idle', 'trigger')
    expect(watch).toHaveBeenCalledWith('idle', { command: 'npm test', cwd: '/repo/.cate/worktrees/lead', callerPanelId: 'supervisor' })
  })

  it('passes model and effort to the launch, independently, on a new terminal and on a reused one', async () => {
    hookConfig = { codex: 'on', 'claude-code': 'on' }
    const agentStarter = starter()
    await agentStarter.start('supervisor', { prompt: 'Fix it', agentId: 'claude-code', model: 'gpt-5' })
    expect(ports.terminals.create).toHaveBeenLastCalledWith(expect.objectContaining({
      launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: 'Fix it', model: 'gpt-5' } },
    }))
    expect(agentStarter.launchOptions('new-terminal')).toEqual({ model: 'gpt-5' })
    await agentStarter.start('supervisor', { agentId: 'claude-code', prompt: 'Fix it', effort: 'high' })
    expect(ports.terminals.create).toHaveBeenLastCalledWith(expect.objectContaining({
      launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: 'Fix it', effort: 'high' } },
    }))
    expect(agentStarter.launchOptions('new-terminal')).toEqual({ effort: 'high' })
    await agentStarter.start('supervisor', { agentId: 'claude-code', prompt: 'Review', terminalPanelId: 'idle', model: 'gpt-5', effort: 'low' })
    expect(ports.terminals.relaunch).toHaveBeenLastCalledWith('idle', expect.objectContaining({
      launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: 'Review', model: 'gpt-5', effort: 'low' } },
    }))
    expect(agentStarter.launchOptions('idle')).toEqual({ model: 'gpt-5', effort: 'low' })
    await agentStarter.start('supervisor', { agentId: 'claude-code', prompt: 'Again', terminalPanelId: 'idle' })
    expect(agentStarter.launchOptions('idle')).toBeUndefined()
  })

  it('takes model and effort with a relation and a done-when condition in the same start', async () => {
    hookConfig = { codex: 'on', 'claude-code': 'on' }
    const watch = vi.fn()
    const all = createAgentStarter(agents, ports as unknown as AgentStartPorts, undefined, { watch })
    await expect(all.start('supervisor', { prompt: 'Fix it', agentId: 'claude-code', model: 'gpt-5', effort: 'high', relation: 'trigger', doneWhen: 'npm test' }))
      .resolves.toEqual({ panelId: 'new-terminal', agentId: 'claude-code', relationId: 'rel-1' })
    expect(ports.terminals.create).toHaveBeenCalledWith(expect.objectContaining({
      launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: 'Fix it', model: 'gpt-5', effort: 'high' } },
    }))
    expect(ports.relations.link).toHaveBeenLastCalledWith('supervisor', 'new-terminal', 'trigger')
    expect(watch).toHaveBeenCalledWith('new-terminal', { command: 'npm test', cwd: '/repo/.cate/worktrees/lead', callerPanelId: 'supervisor' })
  })

  it('refuses, before creating anything, an option or value the chosen agent does not know', async () => {
    hookConfig = { codex: 'on', cursor: 'on' }
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', agentId: 'cursor', effort: 'low', newWorktree: 'fix' })))
      .resolves.toBe('effort-unsupported: Cursor has no effort option')
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', effort: 'low', newWorktree: 'fix' })))
      .resolves.toBe('effort-unsupported: Codex has no effort option')
    hookConfig = { codex: 'on', 'claude-code': 'on' }
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', agentId: 'claude-code', effort: 'huge', newWorktree: 'fix' })))
      .resolves.toBe('effort-unsupported: Claude Code does not know the effort "huge" (low, medium, high, xhigh, max)')
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', model: '-x' }))).resolves.toBe('model-unsupported: model cannot start with "-"')
    await expect(refusal(starter().start(undefined, { prompt: 'Fix it', model: '  ' }))).resolves.toBe('model-required')
    expect(ports.worktrees.create).not.toHaveBeenCalled()
    expect(ports.terminals.create).not.toHaveBeenCalled()
  })

  it('reuses an idle terminal, and refuses a busy one', async () => {
    await expect(starter().start('supervisor', { prompt: 'Review', terminalPanelId: 'idle' })).resolves.toMatchObject({ panelId: 'idle' })
    expect(ports.terminals.relaunch).toHaveBeenCalledWith('idle', expect.objectContaining({ launch: expect.objectContaining({ kind: 'agents.start' }) }))
    ports.terminals.state.mockReturnValue({ alive: true, busy: true })
    await expect(refusal(starter().start('supervisor', { prompt: 'Review', terminalPanelId: 'idle' }))).resolves.toBe('terminal-busy')
  })

  it('lists every agent CLI with whether it can start here', async () => {
    const types = await starter().types()
    expect(types.map((type) => type.agentId)).toEqual(['claude-code', 'codex', 'cursor', 'grok', 'opencode', 'pi', 'kiro'])
    expect(types.find((type) => type.agentId === 'codex')).toEqual({ agentId: 'codex', displayName: 'Codex', ready: true })
    expect(types.find((type) => type.agentId === 'kiro')).toMatchObject({ ready: false })
  })
})

it('serves the authoritative setup types to RPC and CLI callers without a separate hook inspection', async () => {
  const types = vi.fn(async () => [{ agentId: 'codex' as const, displayName: 'Codex', ready: true, connection: 'native' as const }])
  const authoritative = createAgentStarter(agents, ports as unknown as AgentStartPorts, { types })
  expect(await authoritative.types()).toEqual(await types())
  types.mockResolvedValue([{ agentId: 'codex', displayName: 'Codex', ready: false, connection: 'native' }])
  expect(await authoritative.types()).toMatchObject([{ agentId: 'codex', ready: false }])
})
