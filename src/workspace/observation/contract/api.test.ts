import { describe, expect, it } from 'vitest'
import { ArgError, cliAccessDenied, validateCateArgs } from '@kernel/api/contract'
import { observationCliArea, observeApi } from './api'
import { observationSettings } from './settings'

const list = observeApi.methods.list

describe('cate.observe.list', () => {
  it('is a read method the runtime serves, behind the observation area', () => {
    expect(list.method).toBe('cate.observe.list')
    expect(list.access).toBe('read')
    expect(list.handler).toBe('service')
    expect(list.area).toBe(observationCliArea)
    expect(observationCliArea.read?.key).toBe('cliObservationEnabled')
    expect(Object.keys(observationSettings.keys)).toContain(observationCliArea.read?.key)
    expect(Object.keys(observationSettings.keys)).toContain(observationCliArea.control.key)
  })

  it('takes a number of days from 0 to 14, 14 by default', () => {
    expect(validateCateArgs(list, {})).toEqual({ jours: 14 })
    expect(validateCateArgs(list, { jours: 0 })).toEqual({ jours: 0 })
    expect(validateCateArgs(list, { jours: 3 })).toEqual({ jours: 3 })
    for (const jours of [-1, 15, 2.5, 'trois']) expect(() => validateCateArgs(list, { jours }), String(jours)).toThrow(ArgError)
  })

  it('is refused to a terminal until the person turns it on', () => {
    const settings: Record<string, unknown> = { cliEnabled: true, ...Object.fromEntries(Object.entries(observationSettings.keys).map(([key, def]) => [key, def.default])) }
    const read = (key: string) => settings[key]
    expect(cliAccessDenied(list.area, 'read', read)).toMatch(/^observation-read-disabled/)
    settings.cliObservationEnabled = true
    expect(cliAccessDenied(list.area, 'read', read)).toBeNull()
    settings.cliEnabled = false
    expect(cliAccessDenied(list.area, 'read', read)).toMatch(/^cli-disabled/)
  })
})
