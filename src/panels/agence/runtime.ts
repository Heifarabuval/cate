// What the daemon needs for agence panels: the definition, the session bound
// to its deps, and the workspace's regisseur registry (one regisseur per
// repository root, shared by its panels), disposed at workspace shutdown.

import type { PanelFactory, PanelSessionClass, SessionKit } from '@panels/framework/runtime'
import type { PanelRecord } from '@workspace/document/contract'
import definition from './definition'
import { AgenceSession, type AgenceSessionDeps } from './session'
import { createRegisseurs, type RegisseursOptions } from './parts/runtime/regisseur'
import { createStateFiles } from './parts/runtime/stateFiles'

export interface AgencePanels {
  definition: typeof definition
  session: PanelSessionClass
  /** Gives the panels the daemon's panel factory, once it exists (`PanelModule.attach`). */
  attach(factory: PanelFactory): void
  /** Stops every regisseur and waits for them. */
  dispose(): Promise<void>
}

export function createAgencePanels(deps: Pick<AgenceSessionDeps, 'root' | 'terminal'> & Pick<RegisseursOptions, 'cliEnv' | 'trust'>): AgencePanels {
  const regisseurs = createRegisseurs({ cliEnv: deps.cliEnv, trust: deps.trust })
  let factory: PanelFactory | null = null
  const bound: AgenceSessionDeps = {
    root: deps.root,
    terminal: deps.terminal,
    regisseurs,
    files: (dir, onChange) => createStateFiles({ dir, onChange }),
    openEditor: (filePath, near) => factory?.createPanel('editor', { filePath, near }) != null,
  }
  class BoundAgenceSession extends AgenceSession {
    constructor(kit: SessionKit, record: PanelRecord) {
      super(kit, record, bound)
    }
  }
  return { definition, session: BoundAgenceSession as unknown as PanelSessionClass, attach: (given) => { factory = given }, dispose: () => regisseurs.dispose() }
}
