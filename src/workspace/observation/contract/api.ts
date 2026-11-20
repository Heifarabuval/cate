// `cate.observe.*`: the journal of observations from a terminal. The runtime
// serves it as a service; `agence observe list` calls it (FR-016).

import { defineCateApi, defineCliArea, num, opt } from '@kernel/api/contract'
import { RETENTION_DAYS } from './retention'

/**
 * The CLI permission area of these methods. Reading is off by default: an
 * agent that reads the journal could send it to a model. The control cell
 * belongs to the commands that change the journal.
 */
export const observationCliArea = defineCliArea({
  label: 'Observation',
  read: {
    key: 'cliObservationEnabled',
    code: 'observation-read-disabled',
    detail: '`cate observe list`: read the journal of observations, one line per gesture. Off by default: an agent that reads it could send it to a model.',
  },
  control: {
    key: 'cliObservationControlEnabled',
    code: 'observation-control-disabled',
    detail: 'The commands that change the journal. No command uses this cell yet.',
  },
})

export const observeApi = defineCateApi(
  'observe',
  {
    list: {
      access: 'read',
      handler: 'service',
      summary: 'List the observations of the last days, read only',
      args: {
        jours: opt(num.int().min(0).max(RETENTION_DAYS), RETENTION_DAYS).help('Today and this many days before'),
      },
    },
  },
  { area: observationCliArea, summary: 'Read the journal of observations' },
)
