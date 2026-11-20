// What the daemon needs for app panels: the definition, the session bound to
// its deps, and the workspace's one scanner, page server, grants file and
// pending imports (shared by every app panel), the `apps` capability, the
// `cate.app.*` services, and their shutdown.

import { createHash } from 'node:crypto'
import path from 'node:path'
import { createLogger, type Logger } from '@kernel/log/contract'
import type { ClientFeature } from '@kernel/rpc/contract'
import type { ApiRouter } from '@kernel/api/runtime'
import type { RpcServer } from '@kernel/rpc/runtime'
import type { PanelRecord } from '@workspace/document/contract'
import type { PanelSessionClass, SessionKit } from '@panels/framework/runtime'
import { appApi } from './contract/api'
import { appsCapability } from './contract/capability'
import definition from './definition'
import { appsCapabilityImpl } from './runtime/capability'
import { createAppGrants, type AppGrants } from './runtime/grants'
import { createAppImports, type AppImports } from './runtime/import'
import { createAppScanner, type AppScanner } from './runtime/scan'
import { createAppServer, type AppServer } from './runtime/server'
import { appApiHandlers } from './runtime/service'
import { watchFolder } from './runtime/watch'
import { AppSession, type AppSessionDeps } from './session'

export interface AppPanelsDeps {
  /** `~/.cate/panneaux`. */
  dir: string
  /** `<data>/app-grants.json`; the quarantine of pending imports is `<data>/app-imports/`. */
  grantsFile: string
  trust: AppSessionDeps['trust']
  clientHas(connectionId: number | null, feature: ClientFeature): boolean
  /** Where startup failures go; the daemon's `apps` channel by default. */
  log?: Pick<Logger, 'warn'>
}

export interface AppPanels {
  definition: typeof definition
  session: PanelSessionClass
  /** Registers `apps` and `cate.app.*`, and starts watching the folder. */
  attach(context: { rpc: Pick<RpcServer, 'register'>; router: Pick<ApiRouter, 'registerService'> }): void
  dispose(): Promise<void>
}

export function createAppPanels(deps: AppPanelsDeps): AppPanels {
  const log = deps.log ?? createLogger('apps')
  // Nothing is created before a session or the daemon needs it: building the
  // module list (tests, tooling) touches no folder and no file.
  let built: { scanner: AppScanner; server: AppServer; grants: AppGrants; imports: AppImports; bound: AppSessionDeps } | undefined
  const parts = () => {
    if (built) return built
    const grants = createAppGrants({ file: deps.grantsFile, panneauxDir: deps.dir })
    const scanner = createAppScanner({ dir: deps.dir, trust: deps.trust, watch: watchFolder, grants })
    const imports = createAppImports({
      dir: path.join(path.dirname(deps.grantsFile), 'app-imports'),
      panneauxDir: deps.dir,
      grants,
      trust: deps.trust,
      clientHas: deps.clientHas,
      refresh: (id) => scanner.refresh(id)
    })
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
    return (built = { scanner, server, grants, imports, bound })
  }
  class BoundAppSession extends AppSession {
    constructor(kit: SessionKit, record: PanelRecord) {
      super(kit, record, parts().bound)
    }
  }
  return {
    definition,
    session: BoundAppSession as unknown as PanelSessionClass,
    attach({ rpc, router }) {
      const { scanner, imports } = parts()
      rpc.register(appsCapability, appsCapabilityImpl(scanner, imports))
      router.registerService(appApi, appApiHandlers({ dir: deps.dir, scanner, imports, trust: deps.trust }))
      // A folder that cannot be created or watched leaves the list empty, never the daemon down.
      void scanner.start().catch((error) => log.warn('custom panels folder %s unavailable: %O', deps.dir, error))
      void imports.start().catch((error) => log.warn('app imports quarantine unavailable: %O', error))
    },
    async dispose() {
      if (!built) return
      await built.scanner.dispose()
      await built.server.close()
      built.grants.dispose()
    }
  }
}
