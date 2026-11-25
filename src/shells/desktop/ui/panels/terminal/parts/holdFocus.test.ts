// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdFocus } from './holdFocus'

describe('holdFocus', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('takes focus back from the element a click moved it to, while owned', () => {
    vi.useFakeTimers()
    const target = document.createElement('textarea')
    const other = document.createElement('button')
    document.body.append(target, other)
    const stop = holdFocus(() => target, () => true)
    expect(document.activeElement).toBe(target)
    other.focus()
    vi.advanceTimersByTime(25)
    expect(document.activeElement).toBe(target)
    stop()
    other.focus()
    vi.advanceTimersByTime(100)
    expect(document.activeElement).toBe(other)
  })

  it('waits for the element to attach and stops once focus moves elsewhere', () => {
    vi.useFakeTimers()
    const target = document.createElement('textarea')
    const other = document.createElement('button')
    document.body.append(other)
    let owned = true
    holdFocus(() => target, () => owned)
    vi.advanceTimersByTime(50)
    document.body.append(target)
    vi.advanceTimersByTime(25)
    expect(document.activeElement).toBe(target)
    owned = false
    other.focus()
    vi.advanceTimersByTime(100)
    expect(document.activeElement).toBe(other)
  })

  it('leaves focus to a text field the person clicked into after it took focus', () => {
    vi.useFakeTimers()
    const target = document.createElement('textarea')
    const field = document.createElement('textarea')
    document.body.append(target, field)
    holdFocus(() => target, () => true)
    expect(document.activeElement).toBe(target)
    field.focus()
    vi.advanceTimersByTime(100)
    expect(document.activeElement).toBe(field)
  })

  it('leaves focus to a list the person opened after it took focus (a native menu closes when its list loses focus)', () => {
    vi.useFakeTimers()
    const target = document.createElement('textarea')
    const list = document.createElement('select')
    document.body.append(target, list)
    holdFocus(() => target, () => true)
    expect(document.activeElement).toBe(target)
    list.focus()
    vi.advanceTimersByTime(100)
    expect(document.activeElement).toBe(list)
  })
})
