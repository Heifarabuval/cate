import { afterEach, expect, it, vi } from 'vitest'
import { setRuntimeResolver } from '@kernel/rpc/client'
import type { RuntimeProxy } from '@kernel/rpc/contract'
import type { AppEntry, PendingImport } from '../contract'
import { acquireApps, acquireImports, peekApps, peekImports } from './index'

const entry = (id: string): AppEntry => ({ id, status: 'blocked', warnings: [] })
let stop: (() => void) | undefined
afterEach(() => stop?.())

function fakeRuntime() {
  let send: ((list: AppEntry[]) => void) | undefined
  const cancel = vi.fn()
  const watch = vi.fn(() => ({ onEvent: (listener: (list: AppEntry[]) => void) => { send = listener; return () => {} }, cancel }))
  stop = setRuntimeResolver(() => ({ apps: { watch } }) as unknown as RuntimeProxy)
  return { emit: (list: AppEntry[]) => send?.(list), watch, cancel }
}

it('mirrors the list, shares one stream between consumers and closes it on the last release', () => {
  const runtime = fakeRuntime()
  const first = acquireApps('w1')
  const second = acquireApps('w1')
  expect(runtime.watch).toHaveBeenCalledTimes(1)
  expect(first.getSnapshot()).toBeNull()
  const seen = vi.fn()
  first.subscribe(seen)
  runtime.emit([entry('a')])
  expect(second.getSnapshot()).toEqual([entry('a')])
  expect(peekApps('w1')).toEqual([entry('a')])
  expect(seen).toHaveBeenCalledTimes(1)
  first.release()
  expect(runtime.cancel).not.toHaveBeenCalled()
  second.release()
  expect(runtime.cancel).toHaveBeenCalledTimes(1)
  expect(peekApps('w1')).toBeNull()
})

it('mirrors the pending imports of a workspace on their own stream', () => {
  let send: ((list: PendingImport[]) => void) | undefined
  const cancel = vi.fn()
  const watchImports = vi.fn(() => ({ onEvent: (listener: (list: PendingImport[]) => void) => { send = listener; return () => {} }, cancel }))
  stop = setRuntimeResolver(() => ({ apps: { watchImports } }) as unknown as RuntimeProxy)
  const held = acquireImports('w2')
  expect(held.getSnapshot()).toBeNull()
  const pending = { importId: 'i1', appId: 'a' } as PendingImport
  send?.([pending])
  expect(peekImports('w2')).toEqual([pending])
  expect(peekApps('w2')).toBeNull()
  held.release()
  expect(cancel).toHaveBeenCalledTimes(1)
})
