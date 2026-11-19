import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { setRuntimeResolver } from '@kernel/rpc/client'
import type { ChannelEvent } from '@kernel/rpc/contract'
import type { AgentAvailability } from '@services/agents/contract'
import { fakeStream } from '@services/agents/client/testing'
import type { CanvasMenuEntry } from '../../client/layout/canvas'
import { useAgentMenuEntries } from './views'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('offers the ready agents in the canvas menu, and only those', async () => {
  const stream = fakeStream<ChannelEvent<AgentAvailability, AgentAvailability>>()
  const stop = setRuntimeResolver((id) => id === 'menu-agents' ? { agents: { availability: () => stream.sub } } as never : null)
  const host = document.createElement('div')
  const root = createRoot(host)
  let entries: CanvasMenuEntry[] = []
  const Probe = () => { entries = useAgentMenuEntries('menu-agents', 'canvas-1'); return null }
  try {
    await act(async () => { root.render(<Probe />) })
    expect(entries).toEqual([])
    await act(async () => {
      stream.emit({ kind: 'snapshot', snapshot: { snapshot: null, types: [
        { agentId: 'antigravity', displayName: 'Antigravity', ready: true },
        { agentId: 'claude-code', displayName: 'Claude Code', ready: true },
        { agentId: 'codex', displayName: 'Codex', ready: false },
      ] } } as never)
    })
    expect(entries.map(({ id, label }) => [id, label])).toEqual([
      ['agent:antigravity', 'New Antigravity'],
      ['agent:claude-code', 'New Claude Code'],
    ])
  } finally {
    act(() => root.unmount())
    stop()
  }
})
