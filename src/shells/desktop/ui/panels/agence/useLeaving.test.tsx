// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useLeaving } from './useLeaving'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => vi.useRealTimers())

function setup() {
  const host = document.createElement('div')
  const root = createRoot(host)
  const seen: string[] = []
  const View = ({ ids }: { ids: string[] }) => {
    seen.splice(0, seen.length, ...useLeaving(ids, (id) => id).map((s) => `${s.item}${s.leaving ? '*' : ''}${s.entering ? '+' : ''}`))
    return null
  }
  return { seen, render: (ids: string[]) => act(() => root.render(createElement(View, { ids }))) }
}

it('keeps a departed line folding for 200 ms from the very render that drops it, then removes it', () => {
  vi.useFakeTimers()
  const { seen, render } = setup()
  render(['a', 'b', 'c'])
  expect(seen).toEqual(['a', 'b', 'c'])
  render(['a', 'c'])
  expect(seen).toEqual(['a', 'b*', 'c'])
  act(() => { vi.advanceTimersByTime(200) })
  expect(seen).toEqual(['a', 'c'])
})

it('marks a new line entering, never on the first display', () => {
  const { seen, render } = setup()
  render(['a'])
  render(['a', 'b'])
  expect(seen).toEqual(['a', 'b+'])
})
