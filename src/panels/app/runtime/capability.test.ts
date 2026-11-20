import { expect, it, vi } from 'vitest'
import type { AppEntry } from '../contract'
import { appsCapabilityImpl } from './capability'

const entry: AppEntry = { id: 'a', status: 'blocked', warnings: [] }

it('lists, then streams the whole list on every change until unsubscribed', () => {
  let listener: ((entries: AppEntry[]) => void) | undefined
  const off = vi.fn()
  const impl = appsCapabilityImpl({ list: () => [entry], subscribe: (l) => { listener = l; return off } })
  expect(impl.list(undefined as never, undefined as never)).toEqual([entry])
  const emit = vi.fn()
  const stop = impl.watch(undefined as never, { emit } as never, undefined as never)
  expect(emit).toHaveBeenCalledWith([entry])
  listener?.([])
  expect(emit).toHaveBeenLastCalledWith([])
  ;(stop as () => void)()
  expect(off).toHaveBeenCalled()
})
