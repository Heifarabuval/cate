import { describe, expect, it, vi } from 'vitest'
import { BOITE_ACTIONS, bindBoiteKeys, runBoiteCommand } from './keyboard'

describe('boite keyboard actions', () => {
  it('declares J, K, arrow down, Enter and Cmd+Enter', () => {
    const keys = Object.fromEntries(Object.entries(BOITE_ACTIONS).map(([id, spec]) => [id, [spec.key?.key, spec.key?.command]]))
    expect(keys).toEqual({
      'boite.next': ['j', false],
      'boite.previous': ['k', false],
      'boite.skip': ['↓', false],
      'boite.open': ['\r', false],
      'boite.send': ['\r', true],
    })
  })

  it('does not repeat Enter or Cmd+Enter (one press, one send), and yields to a text field', () => {
    for (const id of ['boite.open', 'boite.send'] as const) {
      expect(BOITE_ACTIONS[id].keys).toMatchObject({ noRepeat: true, yieldToText: true, windowOnly: true })
    }
    expect(BOITE_ACTIONS['boite.next'].keys).toMatchObject({ yieldToText: true, windowOnly: true })
  })

  it('runs a command on the view of its panel only, and not once that view is gone', () => {
    const one = vi.fn()
    const two = vi.fn()
    const offOne = bindBoiteKeys('p1', one)
    bindBoiteKeys('p2', two)
    expect(runBoiteCommand('p1', 'send')).toBe(true)
    expect(one).toHaveBeenCalledWith('send')
    expect(two).not.toHaveBeenCalled()
    offOne()
    expect(runBoiteCommand('p1', 'send')).toBe(false)
  })
})
