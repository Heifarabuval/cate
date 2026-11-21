import { expect, it, vi } from 'vitest'
import { showElementToAgents } from './showElement'

const element = { selector: '#save', role: 'button', text: 'Save', rect: { x: 1, y: 2, width: 3, height: 4 } }

it('sends the picked element to every related panel that hosts an agent', async () => {
  const send = vi.fn(async (panelId: string) => { if (panelId === 'shell') throw new Error('no-agent-in-terminal') })
  const outcome = await showElementToAgents({ pick: async () => ({ result: element }), send }, ['agent', 'shell'], 'https://example.test/')
  expect(outcome).toBe('sent')
  expect(send).toHaveBeenCalledWith('agent', expect.stringContaining('selector: #save'))
})

it('sends nothing when the person cancels or the pick fails', async () => {
  const send = vi.fn(async () => {})
  expect(await showElementToAgents({ pick: async () => ({ result: null }), send }, ['agent'], 'https://example.test/')).toBe('cancelled')
  expect(await showElementToAgents({ pick: async () => ({ error: 'no-guest' }), send }, ['agent'], 'https://example.test/')).toBe('cancelled')
  expect(send).not.toHaveBeenCalled()
})

it('never picks without a related panel, and says when no agent took it', async () => {
  const pick = vi.fn(async () => ({ result: element }))
  expect(await showElementToAgents({ pick, send: async () => {} }, [], 'https://example.test/')).toBe('no-agent')
  expect(pick).not.toHaveBeenCalled()
  expect(await showElementToAgents({ pick, send: async () => { throw new Error('gone') } }, ['shell'], 'https://example.test/')).toBe('no-agent')
})
