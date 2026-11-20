import type { CapabilityImpl } from '@kernel/rpc/runtime'
import type { appsCapability } from '../contract/capability'
import type { AppScanner } from './scan'

/** The runtime half of `apps`: the scanner's list, and its changes as a stream. */
export function appsCapabilityImpl(scanner: Pick<AppScanner, 'list' | 'subscribe'>): CapabilityImpl<typeof appsCapability> {
  return {
    list: () => scanner.list(),
    watch: (_params, sink) => {
      sink.emit(scanner.list())
      return scanner.subscribe((entries) => sink.emit(entries))
    }
  }
}
