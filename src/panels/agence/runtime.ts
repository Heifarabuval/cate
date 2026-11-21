// What the daemon needs for agence panels: the definition, the session bound
// to its deps, and the workspace's regisseur registry (one regisseur per
// repository root, shared by its panels), disposed at workspace shutdown.

import type { PanelSessionClass, SessionKit } from '@panels/framework/runtime'
import type { PanelRecord } from '@workspace/document/contract'
import definition from './definition'
import { AgenceSession, type AgenceSessionDeps } from './session'
import { createRegisseurs, type RegisseursOptions } from './parts/runtime/regisseur'
import { createStateFiles } from './parts/runtime/stateFiles'

export interface AgencePanels {
  definition: typeof definition
  session: PanelSessionClass
  /** Stops every regisseur and waits for them. */
  dispose(): Promise<void>
}

export function createAgencePanels(deps: Pick<AgenceSessionDeps, 'root' | 'terminal'> & Pick<RegisseursOptions, 'cliEnv' | 'trust'>): AgencePanels {
  const regisseurs = createRegisseurs({ cliEnv: deps.cliEnv, trust: deps.trust })
  const bound: AgenceSessionDeps = {
    root: deps.root,
    terminal: deps.terminal,
    regisseurs,
    files: (dir, onChange) => createStateFiles({ dir, onChange }),
  }
  class BoundAgenceSession extends AgenceSession {
    constructor(kit: SessionKit, record: PanelRecord) {
      super(kit, record, bound)
    }
  }
  return { definition, session: BoundAgenceSession as unknown as PanelSessionClass, dispose: () => regisseurs.dispose() }
}
