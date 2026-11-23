// Closing the agence panel while its orchestrator runs asks first, like a
// terminal (architecture 11.2 rule 6). Without this guard the session's
// `dirty` refused the removal and the close button did nothing.

import type { CloseGuard } from '@client/host'
import { clientUi } from '@kernel/interaction'
import type { AgenceSnapshot } from '@panels/agence/contract/types'
import { snapshotOf } from '../terminal'

export const agenceCloseGuard: CloseGuard = async ({ session }) => {
  const snapshot = await snapshotOf<AgenceSnapshot>(session)
  if (!snapshot?.ptyId || snapshot.orchestrator !== 'running') return true
  return (await clientUi().confirmCloseTerminal({ count: 1, processName: null })) === 'close' ? 'discard' : false
}
