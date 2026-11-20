import { defineSettings, setting } from '@kernel/settings/contract'
import { isDomainName } from './exclusions'
import { isIsoTime } from './observation'

/** Most domains a person adds or removes: a hand-edited file stays small. */
const MAX_DOMAINS = 500

const domains = (value: string[]): boolean => value.length <= MAX_DOMAINS && value.every(isDomainName)

/**
 * The observation of one workspace. Off until the person accepts: nothing is
 * written, and no `observations/` folder exists, while `observationAccord`
 * is empty (FR-003). A setting cannot hold `null`, so "no accord" is an empty
 * string and the accord is the time the person gave it.
 */
export const observationSettings = defineSettings({
  scope: 'workspace',
  keys: {
    observationAccord: setting('', (value) => value === '' || isIsoTime(value)),
    observationPause: setting(false),
    /** Domains the person adds to the exclusion list. */
    observationExclusionsAjoutees: setting<string[]>([], domains),
    /** Default domains the person removes from it. */
    observationExclusionsRetirees: setting<string[]>([], domains),
    /** `cate observe list` from a terminal (area `observationCliArea`). Off: an agent that reads the journal could send it to a model (FR-018). */
    cliObservationEnabled: setting(false),
    cliObservationControlEnabled: setting(false),
  },
})
