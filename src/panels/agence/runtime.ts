// What the daemon needs for agence panels: the definition and the session
// bound to its deps, with one regisseur registry for the workspace (one
// regisseur per repository root, shared by its panels).

import type { PanelSessionClass, SessionKit } from '@panels/framework/runtime'
import type { PanelRecord } from '@workspace/document/contract'
import definition from './definition'
import { AgenceSession, type AgenceSessionDeps } from './session'
import { createRegisseurs } from './parts/runtime/regisseur'
import { createStateFiles } from './parts/runtime/stateFiles'

export interface AgencePanels {
  definition: typeof definition
  session: PanelSessionClass
}

export function createAgencePanels(deps: Pick<AgenceSessionDeps, 'root' | 'terminal' | 'cliEnv'>): AgencePanels {
  const bound: AgenceSessionDeps = {
    ...deps,
    regisseurs: createRegisseurs(),
    files: (dir, onChange) => createStateFiles({ dir, onChange }),
  }
  class BoundAgenceSession extends AgenceSession {
    constructor(kit: SessionKit, record: PanelRecord) {
      super(kit, record, bound)
    }
  }
  return { definition, session: BoundAgenceSession as unknown as PanelSessionClass }
}
