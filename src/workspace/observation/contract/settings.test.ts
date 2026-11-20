import { describe, expect, it } from 'vitest'
import { composeSettings } from '@kernel/settings/contract'
import { observationSettings } from './settings'

const table = composeSettings<Record<string, unknown>>('workspace', [observationSettings])

describe('observationSettings', () => {
  it('is a workspace slice', () => {
    expect(observationSettings.scope).toBe('workspace')
  })

  it('starts off: no accord, no pause, no exclusion of the user, no CLI access', () => {
    expect(table.defaults).toEqual({
      observationAccord: '',
      observationPause: false,
      observationExclusionsAjoutees: [],
      observationExclusionsRetirees: [],
      cliObservationEnabled: false,
      cliObservationControlEnabled: false,
    })
  })

  it('takes an accord that is a date, or none', () => {
    expect(table.validate('observationAccord', '')).toBe(true)
    expect(table.validate('observationAccord', '2026-11-20T10:00:00.000Z')).toBe(true)
    for (const value of ['oui', 'true', '2026-11-20', '2026-13-45T10:00:00.000Z', ' ', 1, true, null]) {
      expect(table.validate('observationAccord', value), String(value)).toBe(false)
    }
  })

  it('takes the domains the user adds or removes, as bare domains', () => {
    for (const key of ['observationExclusionsAjoutees', 'observationExclusionsRetirees']) {
      expect(table.validate(key, [])).toBe(true)
      expect(table.validate(key, ['exemple.fr', 'mail.exemple.fr'])).toBe(true)
      expect(table.validate(key, ['Exemple.FR'])).toBe(false)
      expect(table.validate(key, ['https://exemple.fr'])).toBe(false)
      expect(table.validate(key, ['exemple.fr/compte'])).toBe(false)
      expect(table.validate(key, ['exemple'])).toBe(false)
      expect(table.validate(key, [''])).toBe(false)
      expect(table.validate(key, [`${'a'.repeat(250)}.fr`])).toBe(false)
      expect(table.validate(key, [3])).toBe(false)
      expect(table.validate(key, 'exemple.fr')).toBe(false)
    }
  })

  it('falls back to off when the hand-edited file is wrong', () => {
    const read = table.normalize({ observationAccord: 'oui', observationPause: 'non', cliObservationEnabled: 'yes' })
    expect(read.observationAccord).toBe('')
    expect(read.observationPause).toBe(false)
    expect(read.cliObservationEnabled).toBe(false)
  })
})
