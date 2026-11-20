import { defineCapability, method } from '@kernel/rpc/contract'

/** Where the observation stands, for the panels that show it. Never a line of the journal. */
export interface ObservationState {
  /** When the person accepted (ISO time), null before. */
  accord: string | null
  pause: boolean
  /** Lines are written now: accepted, not paused, no write failed. */
  actif: boolean
  /** Why the writes stopped by themselves (disk full, file unreadable), null otherwise. */
  erreur: string | null
}

export const observationCapability = defineCapability('observation', {
  methods: {
    state: method<void, ObservationState>(),
  },
})

declare module '@kernel/rpc/contract' {
  interface CapabilityRegistry {
    observation: typeof observationCapability
  }
}
