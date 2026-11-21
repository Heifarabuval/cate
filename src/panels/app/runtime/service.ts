// The `service` methods of `cate.app.*` (spec 007 FR-012 to FR-015, FR-019).
// `export` writes only `--out`; `import` only stages into the quarantine.
// Nothing here writes into the panels folder or installs (SC-003).

import path from 'node:path'
import type { CateServiceHandlers } from '@kernel/api/contract'
import { RpcError } from '@kernel/rpc/contract'
import type { appApi } from '../contract/api'
import { exportPanel } from './export'
import type { AppImports } from './import'
import type { AppScanner } from './scan'

export interface AppApiDeps {
  /** `~/.cate/panneaux`. */
  dir: string
  scanner: Pick<AppScanner, 'list'>
  imports: Pick<AppImports, 'list' | 'stage'>
  trust: { isTrusted(): boolean }
}

export function appApiHandlers(deps: AppApiDeps) {
  return {
    list: () => deps.scanner.list(),
    imports: () => deps.imports.list(),
    export: async ({ id, out }) => {
      // Only a panel the scanner found: the id never names a path out of the folder.
      if (!deps.scanner.list().some((entry) => entry.id === id)) throw new RpcError('rejected', `app-unknown: panneau inconnu « ${id} »`)
      const result = await exportPanel({ folder: path.join(deps.dir, id), panneauxDir: deps.dir, out })
      if (!result.ok) throw new RpcError('rejected', result.error)
      return {
        out: result.out,
        omitted: result.omitted,
        note: 'contrôle des secrets passé : il réduit une erreur courante, il ne prouve pas l’absence de secret',
        fingerprint: result.fingerprint
      }
    },
    import: async ({ source, fingerprint }) => {
      if (!deps.trust.isTrusted()) throw new RpcError('rejected', 'workspace non approuvé : aucun panneau perso ne peut y être importé')
      const result = await deps.imports.stage(source, { fingerprint })
      if (!result.ok) throw new RpcError('rejected', result.error)
      return { importId: result.importId, fingerprint: result.fingerprint }
    }
  } satisfies CateServiceHandlers<typeof appApi>
}
