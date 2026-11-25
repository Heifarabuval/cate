import { defineCapability, method } from '@kernel/rpc/contract'
import type { LoadedOrg } from './load'

/** The org of this workspace, read from its org file. */
export const orgCapability = defineCapability('org', {
	methods: {
		/** The solo profile without a file, readable errors with an invalid one. */
		load: method<void, LoadedOrg>()
	}
})

declare module '@kernel/rpc/contract' {
	interface CapabilityRegistry {
		org: typeof orgCapability
	}
}
