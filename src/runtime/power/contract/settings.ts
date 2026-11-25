import { defineSettings, numberIn, setting } from '@kernel/settings/contract/define'

/** Agent ceiling of the runtime's machine (architecture 7.9): the reserve is
 *  per machine because workspace settings live on the runtime's machine. */
export const powerSettings = defineSettings({
  scope: 'workspace',
  keys: {
    /** Memory left for the rest of the machine, in MB. */
    agentMemoryReserveMb: setting(4096, numberIn(0, 1_048_576, { integer: true })),
    /** Most agents alive at once, memory aside. */
    agentsMax: setting(4, numberIn(1, 64, { integer: true })),
  },
})
