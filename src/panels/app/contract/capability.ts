import { defineCapability, method, stream } from '@kernel/rpc/contract'
import type { PendingImport } from './bundle'
import type { AppEntry } from './entry'

/** The custom panels found in `~/.cate/panneaux/` on the runtime's machine,
 *  and the imports waiting for a human's click. `acceptImport` is the only
 *  way into that folder (spec 007 FR-017): a client with `webview` calls it
 *  from the import card; the `cate` API never does. */
export const appsCapability = defineCapability('apps', {
  methods: {
    list: method<void, AppEntry[]>(),
    imports: method<void, PendingImport[]>(),
    /** `fingerprint`: the one of the card the user read. `replace`: the explicit choice to replace the panel of that id. */
    acceptImport: method<{ importId: string; fingerprint: string; replace?: boolean }, { appId: string }>(),
    dropImport: method<{ importId: string }, void>()
  },
  streams: {
    /** The whole list, then again on every change of a folder. */
    watch: stream<void, AppEntry[]>(),
    /** The pending imports, then again on every change. */
    watchImports: stream<void, PendingImport[]>()
  }
})

declare module '@kernel/rpc/contract' {
  interface CapabilityRegistry {
    apps: typeof appsCapability
  }
}
