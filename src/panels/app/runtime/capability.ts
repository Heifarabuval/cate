import { RpcError } from '@kernel/rpc/contract'
import type { CapabilityImpl } from '@kernel/rpc/runtime'
import type { appsCapability } from '../contract/capability'
import type { AppImports } from './import'
import type { AppScanner } from './scan'

/** The runtime half of `apps`: the scanner's list, the pending imports, and their changes as streams. */
export function appsCapabilityImpl(
  scanner: Pick<AppScanner, 'list' | 'subscribe'>,
  imports: Pick<AppImports, 'list' | 'subscribe' | 'accept' | 'drop'>
): CapabilityImpl<typeof appsCapability> {
  return {
    list: () => scanner.list(),
    watch: (_params, sink) => {
      sink.emit(scanner.list())
      return scanner.subscribe((entries) => sink.emit(entries))
    },
    imports: () => imports.list(),
    watchImports: (_params, sink) => {
      sink.emit(imports.list())
      return imports.subscribe((list) => sink.emit(list))
    },
    acceptImport: async (params, ctx) => {
      const result = await imports.accept(params, { connectionId: ctx.connection.id })
      if (!result.ok) throw new RpcError('rejected', result.error)
      return { appId: result.appId }
    },
    dropImport: ({ importId }) => imports.drop(importId)
  }
}
