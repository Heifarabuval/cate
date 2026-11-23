import { describe, expect, it, vi } from 'vitest'
import type { SessionHandle } from '@client/connections'
import type { CloseGuardContext } from '@client/host'
import type { AgenceSnapshot } from '@panels/agence/contract/types'
import { installMockClientUi } from '../../../../../test/clientUi'
import { agenceCloseGuard } from './confirmClose'

const context = (snapshot: Partial<AgenceSnapshot> | null): CloseGuardContext => ({
  workspaceId: 'w',
  record: {} as CloseGuardContext['record'],
  session: { getSnapshot: () => (snapshot ? { snapshot } : null), subscribe: () => () => {} } as unknown as SessionHandle,
  closing: new Set()
})

describe('agenceCloseGuard', () => {
  it('closes without asking when the orchestrator is not running', async () => {
    const ui = installMockClientUi({ confirmCloseTerminal: vi.fn(async () => 'cancel' as const) })
    await expect(agenceCloseGuard(context({ ptyId: null, orchestrator: 'exited' }))).resolves.toBe(true)
    expect(ui.confirmCloseTerminal).not.toHaveBeenCalled()
  })

  it('asks, then discards, when the orchestrator runs', async () => {
    installMockClientUi({ confirmCloseTerminal: vi.fn(async () => 'close' as const) })
    await expect(agenceCloseGuard(context({ ptyId: 'p', orchestrator: 'running' }))).resolves.toBe('discard')
  })

  it('keeps the panel when the person cancels', async () => {
    installMockClientUi({ confirmCloseTerminal: vi.fn(async () => 'cancel' as const) })
    await expect(agenceCloseGuard(context({ ptyId: 'p', orchestrator: 'running' }))).resolves.toBe(false)
  })
})
