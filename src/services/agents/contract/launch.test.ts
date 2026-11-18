import { describe, expect, it } from 'vitest'
import { AGENTS } from './registry'
import { agentLaunchCommand, agentLaunchOptionsError, agentTaskText } from './launch'

describe('agentLaunchCommand', () => {
  it('resolves only canonical agent ids to exact argv without a shell', () => {
    const task = 'Fix it; touch /tmp/pwned'
    const prefixed = `Complete this coding task:\n\n${task}`
    expect(AGENTS.map((agent) => ({ id: agent.id, command: agentLaunchCommand({ agentId: agent.id, prompt: task }) }))).toEqual([
      { id: 'claude-code', command: { executable: 'claude', args: [prefixed] } },
      { id: 'codex', command: { executable: 'codex', args: [prefixed] } },
      { id: 'cursor', command: { executable: 'cursor-agent', args: [prefixed] } },
      { id: 'antigravity', command: { executable: 'agy', args: ['--prompt-interactive', prefixed] } },
      { id: 'grok', command: { executable: 'grok', args: [prefixed] } },
      { id: 'opencode', command: { executable: 'opencode', args: ['--prompt', prefixed] } },
      { id: 'pi', command: { executable: 'pi', args: [prefixed] } },
      { id: 'kiro', command: { executable: 'kiro-cli', args: ['chat', '--v3', prefixed] } },
    ])
  })

  it('keeps option-looking and subcommand-looking prompts positional', () => {
    expect(agentLaunchCommand({ agentId: 'codex', prompt: '--dangerously-bypass-approvals-and-sandbox' }).args).toEqual([
      'Complete this coding task:\n\n--dangerously-bypass-approvals-and-sandbox',
    ])
    expect(agentLaunchCommand({ agentId: 'codex', prompt: 'exec' }).args).toEqual(['Complete this coding task:\n\nexec'])
  })

  it('opens the interactive session without a prompt', () => {
    expect(AGENTS.map((agent) => ({ id: agent.id, command: agentLaunchCommand({ agentId: agent.id }) }))).toEqual([
      { id: 'claude-code', command: { executable: 'claude', args: [] } },
      { id: 'codex', command: { executable: 'codex', args: [] } },
      { id: 'cursor', command: { executable: 'cursor-agent', args: [] } },
      { id: 'antigravity', command: { executable: 'agy', args: [] } },
      { id: 'grok', command: { executable: 'grok', args: [] } },
      { id: 'opencode', command: { executable: 'opencode', args: [] } },
      { id: 'pi', command: { executable: 'pi', args: [] } },
      { id: 'kiro', command: { executable: 'kiro-cli', args: ['chat', '--v3'] } },
    ])
  })

  it('rejects blank prompts', () => {
    expect(() => agentLaunchCommand({ agentId: 'codex', prompt: '   ' })).toThrow('A prompt is required')
  })

  it('puts the declared model and effort options before the prompt, each on its own', () => {
    const prompt = 'Complete this coding task:\n\nFix it'
    expect(agentLaunchCommand({ agentId: 'claude-code', prompt: 'Fix it', model: 'sonnet', effort: 'low' }).args)
      .toEqual(['--model', 'sonnet', '--effort', 'low', prompt])
    expect(agentLaunchCommand({ agentId: 'claude-code', prompt: 'Fix it', model: 'sonnet' }).args).toEqual(['--model', 'sonnet', prompt])
    expect(agentLaunchCommand({ agentId: 'claude-code', prompt: 'Fix it', effort: 'high' }).args).toEqual(['--effort', 'high', prompt])
    expect(agentLaunchCommand({ agentId: 'codex', prompt: 'Fix it', model: 'gpt-5' }).args)
      .toEqual(['--model', 'gpt-5', prompt])
    expect(agentLaunchCommand({ agentId: 'claude-code', model: 'opus' })).toEqual({ executable: 'claude', args: ['--model', 'opus'] })
    expect(agentLaunchCommand({ agentId: 'antigravity', prompt: 'Fix it', model: 'gemini-3.1-pro-high', effort: 'high' }).args)
      .toEqual(['--model', 'gemini-3.1-pro-high', '--effort', 'high', '--prompt-interactive', prompt])
  })

  it('refuses an option the agent does not declare or a value it does not know', () => {
    expect(agentLaunchOptionsError('claude-code', { model: 'sonnet', effort: 'low' })).toBeNull()
    expect(agentLaunchOptionsError('claude-code', {})).toBeNull()
    expect(agentLaunchOptionsError('cursor', { model: 'auto' })).toBeNull()
    expect(agentLaunchOptionsError('cursor', { effort: 'low' })).toBe('Cursor has no effort option')
    expect(agentLaunchOptionsError('kiro', { model: 'x' })).toBe('Kiro has no model option')
    expect(agentLaunchOptionsError('codex', { effort: 'low' })).toBe('Codex has no effort option')
    expect(agentLaunchOptionsError('pi', { model: 'x' })).toBe('Pi has no model option')
    expect(agentLaunchOptionsError('antigravity', { model: 'auto', effort: 'max' })).toBeNull()
    expect(agentLaunchOptionsError('antigravity', { effort: 'huge' })).toBe('Antigravity does not know the effort "huge" (low, medium, high, xhigh, max)')
    expect(agentLaunchOptionsError('claude-code', { effort: 'huge' })).toBe('Claude Code does not know the effort "huge" (low, medium, high, xhigh, max)')
    expect(agentLaunchOptionsError('claude-code', { model: '--dangerously-skip-permissions' })).toBe('model cannot start with "-"')
    expect(agentLaunchOptionsError('claude-code', { model: 'a\0b' })).toBe('model cannot contain NUL bytes')
    expect(() => agentLaunchCommand({ agentId: 'cursor', prompt: 'x', effort: 'low' })).toThrow('Cursor has no effort option')
  })

  it('keeps a model with spaces, quotes, semicolons and substitutions one literal argument', () => {
    const model = `a b "c" 'd'; touch /tmp/pwned $(id) \`id\` | x`
    for (const agentId of ['claude-code', 'codex', 'cursor', 'opencode'] as const) {
      const { args } = agentLaunchCommand({ agentId, prompt: 'Fix it', model })
      expect(args.filter((arg) => arg === model)).toEqual([model])
      expect(args.indexOf(model)).toBe(args.indexOf('--model') + 1)
    }
  })

  it('shows the prompt as written', () => {
    const [arg] = agentLaunchCommand({ agentId: 'codex', prompt: 'Fix it' }).args
    expect(agentTaskText(arg)).toBe('Fix it')
    expect(agentTaskText('Plain')).toBe('Plain')
  })
})
