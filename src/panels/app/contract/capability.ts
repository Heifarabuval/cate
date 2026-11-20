import { defineCapability, method, stream } from '@kernel/rpc/contract'
import type { AppEntry } from './entry'

/** The custom panels found in `~/.cate/panneaux/` on the runtime's machine. */
export const appsCapability = defineCapability('apps', {
  methods: {
    list: method<void, AppEntry[]>()
  },
  streams: {
    /** The whole list, then again on every change of a folder. */
    watch: stream<void, AppEntry[]>()
  }
})

declare module '@kernel/rpc/contract' {
  interface CapabilityRegistry {
    apps: typeof appsCapability
  }
}
