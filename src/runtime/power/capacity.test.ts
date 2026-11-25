import { describe, expect, it } from 'vitest'
import { agentCapacity, DEFAULT_AGENT_MB } from './contract/capacity'
import { createCapacity } from './runtime/capacity'
import { parseAgentMb, parseFreePercentage } from './runtime/memory'

const base = { reserveMb: 4096, maxAgents: 4 }

describe('agentCapacity', () => {
	it('caps at maxAgents with plenty of memory', () => {
		const c = agentCapacity({ ...base, availableMb: 20000, agentMb: [1000, 1000] })
		expect(c).toMatchObject({ ceiling: 4, live: 2, canStart: true, reason: null })
	})
	it('queues with a readable reason when memory is short', () => {
		const c = agentCapacity({ ...base, availableMb: 3174, agentMb: [1000, 1000] })
		expect(c.ceiling).toBe(2)
		expect(c.canStart).toBe(false)
		expect(c.reason).toBe('mémoire : 3,1 Go dispo, réserve 4,0 Go')
	})
	it('counts the room left on top of live agents', () => {
		const c = agentCapacity({ ...base, availableMb: 4096 + 2500, agentMb: [1000] })
		expect(c.ceiling).toBe(3)
		expect(c.canStart).toBe(true)
	})
	it('uses the default agent size when none is alive', () => {
		const c = agentCapacity({ ...base, availableMb: 4096 + DEFAULT_AGENT_MB * 2, agentMb: [] })
		expect(c).toMatchObject({ ceiling: 2, live: 0, avgAgentMb: DEFAULT_AGENT_MB, canStart: true })
	})
	it('allows none when the reserve exceeds what is available', () => {
		const c = agentCapacity({ ...base, availableMb: 2000, agentMb: [] })
		expect(c).toMatchObject({ ceiling: 0, canStart: false })
		expect(c.reason).toContain('mémoire')
	})
	it('stops handing out slots when pressure rises, keeps live agents', () => {
		const c = agentCapacity({ ...base, availableMb: 500, agentMb: [1000, 1000, 1000] })
		expect(c).toMatchObject({ ceiling: 3, live: 3, canStart: false })
	})
	it('says the cap reached when memory is not the limit', () => {
		const c = agentCapacity({ ...base, availableMb: 40000, agentMb: [1, 1, 1, 1] })
		expect(c.canStart).toBe(false)
		expect(c.reason).toBe('plafond : 4 agents sur 4 autorisés')
	})
})

describe('system readers', () => {
	it('parses memory_pressure', () => {
		expect(parseFreePercentage('x\nSystem-wide memory free percentage: 62%\n')).toBe(62)
		expect(parseFreePercentage('nothing')).toBeNull()
	})
	it('sums each claude with its children, once', () => {
		const ps = [
			'  10     1  1024 /usr/bin/zsh',
			'  20    10  2048 /Users/x/.local/bin/claude',
			'  21    20  1024 node',
			'  22    21  1024 rg',
			'  30    10  4096 claude',
			'  31    30   512 claude',
			'  40    10  9999 Safari',
		].join('\n')
		expect(parseAgentMb(ps)).toEqual([4, 4.5])
	})
	it('computes from a simulated reading', async () => {
		const get = createCapacity({ read: async () => ({ availableMb: 9000, agentMb: [1000] }), reserveMb: () => 4096, maxAgents: () => 4 })
		expect((await get()).ceiling).toBe(4)
	})
})
