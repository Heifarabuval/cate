// What the daemon needs for app panels: the definition, the session bound to
// its deps, and the workspace's one scanner, page server and grants file
// (shared by every app panel), the `apps` capability, and their shutdown.

import { createHash } from 'node:crypto'
import type { ClientFeature } from '@kernel/rpc/contract'
import type { RpcServer } from '@kernel/rpc/runtime'
import type { PanelRecord } from '@workspace/document/contract'
import type { PanelSessionClass, SessionKit } from '@panels/framework/runtime'
import { appsCapability } from './contract/capability'
import definition from './definition'
import { appsCapabilityImpl } from './runtime/capability'
import { createAppGrants, type AppGrants } from './runtime/grants'
import { createAppScanner, type AppScanner } from './runtime/scan'
import { createAppServer, type AppServer } from './runtime/server'
import { watchFolder } from './runtime/watch'
import { AppSession, type AppSessionDeps } from './session'

export interface AppPanelsDeps {
  /** `~/.cate/panneaux`. */
  dir: string
  /** `<data>/app-grants.json`. */
  grantsFile: string
  trust: AppSessionDeps['trust']
  clientHas(connectionId: number | null, feature: ClientFeature): boolean
}

export interface AppPanels {
  definition: typeof definition
  session: PanelSessionClass
  /** Registers `apps` and starts watching the folder. */
  attach(context: { rpc: Pick<RpcServer, 'register'> }): void
  dispose(): Promise<void>
}

export function createAppPanels(deps: AppPanelsDeps): AppPanels {
  // Nothing is created before a session or the daemon needs it: building the
  // module list (tests, tooling) touches no folder and no file.
  let built: { scanner: AppScanner; server: AppServer; grants: AppGrants; bound: AppSessionDeps } | undefined
  const parts = () => {
    if (built) return built
    const scanner = createAppScanner({ dir: deps.dir, trust: deps.trust, watch: watchFolder })
    const grants = createAppGrants({ file: deps.grantsFile, panneauxDir: deps.dir })
    const server = createAppServer({
      dir: deps.dir,
      isTrusted: () => deps.trust.isTrusted(),
      networkHosts: (id) => scanner.manifest(id)?.permissions.network ?? []
    })
    const bound: AppSessionDeps = {
      scanner,
      grants,
      server,
      trust: deps.trust,
      clientHas: deps.clientHas,
      hash: (text) => createHash('sha256').update(text).digest('hex')
    }
    return (built = { scanner, server, grants, bound })
  }
  class BoundAppSession extends AppSession {
    constructor(kit: SessionKit, record: PanelRecord) {
      super(kit, record, parts().bound)
    }
  }
  return {
    definition,
    session: BoundAppSession as unknown as PanelSessionClass,
    attach({ rpc }) {
      const { scanner } = parts()
      rpc.register(appsCapability, appsCapabilityImpl(scanner))
      // A folder that cannot be created or watched leaves the list empty, never the daemon down.
      void scanner.start().catch(() => {})
    },
    async dispose() {
      if (!built) return
      await built.scanner.dispose()
      await built.server.close()
      built.grants.dispose()
    }
  }
}
