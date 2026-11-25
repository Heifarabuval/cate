// Pure side of the agent ceiling: what the machine's memory allows. The
// runtime reads the system; this only computes, so it tests with made-up numbers.

/** Memory one agent is assumed to need while none is alive to measure. */
export const DEFAULT_AGENT_MB = 1500

export interface CapacityInput {
  /** Memory the system can give without pressure, MB. */
  availableMb: number
  reserveMb: number
  /** Resident memory of each live agent (`claude` and its children), MB. */
  agentMb: readonly number[]
  maxAgents: number
}

export interface AgentCapacity {
  /** How many agents the machine can hold at once. */
  ceiling: number
  live: number
  availableMb: number
  reserveMb: number
  /** Average memory of a live agent, or the default when none is alive. */
  avgAgentMb: number
  /** A new agent may start. False means it waits in the queue. */
  canStart: boolean
  /** Why a new agent waits; null when it may start. */
  reason: string | null
}

const gb = (mb: number) => (mb / 1024).toFixed(1).replace('.', ',')

export function agentCapacity(input: CapacityInput): AgentCapacity {
  const { availableMb, reserveMb, agentMb, maxAgents } = input
  const live = agentMb.length
  const avgAgentMb = live ? agentMb.reduce((a, b) => a + b, 0) / live : DEFAULT_AGENT_MB
  // Live agents already weigh on `availableMb`: the room left adds to them.
  const byMemory = Math.max(0, Math.floor((availableMb - reserveMb) / avgAgentMb)) + live
  const ceiling = Math.min(maxAgents, byMemory)
  // Above the ceiling nobody is stopped: the pool only stops handing out slots.
  const canStart = live < ceiling
  let reason: string | null = null
  if (!canStart) {
    reason = live >= maxAgents && byMemory >= maxAgents
      ? `plafond : ${live} agents sur ${maxAgents} autorisés`
      : `mémoire : ${gb(availableMb)} Go dispo, réserve ${gb(reserveMb)} Go`
  }
  return { ceiling, live, availableMb, reserveMb, avgAgentMb, canStart, reason }
}
