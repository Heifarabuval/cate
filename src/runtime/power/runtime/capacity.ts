import { agentCapacity, type AgentCapacity } from '../contract/capacity'
import type { MemoryReading } from './memory'

export interface CapacityDeps {
  read: () => Promise<MemoryReading>
  reserveMb: () => number
  maxAgents: () => number
}

export function createCapacity(deps: CapacityDeps): () => Promise<AgentCapacity> {
  return async () => {
    const { availableMb, agentMb } = await deps.read()
    return agentCapacity({ availableMb, agentMb, reserveMb: deps.reserveMb(), maxAgents: deps.maxAgents() })
  }
}
