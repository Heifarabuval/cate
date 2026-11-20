import { expect, it, vi } from 'vitest'
import type { AppEntry, PendingImport } from '../contract'
import { appsCapability } from '../contract/capability'
import { appsCapabilityImpl } from './capability'
import type { AppImports } from './import'

const entry: AppEntry = { id: 'a', status: 'blocked', warnings: [] }

it('lists, then streams the whole list on every change until unsubscribed', () => {
  let listener: ((entries: AppEntry[]) => void) | undefined
  const off = vi.fn()
  const impl = appsCapabilityImpl({ list: () => [entry], subscribe: (l) => { listener = l; return off } }, imports())
  expect(impl.list(undefined as never, undefined as never)).toEqual([entry])
  const emit = vi.fn()
  const stop = impl.watch(undefined as never, { emit } as never, undefined as never)
  expect(emit).toHaveBeenCalledWith([entry])
  listener?.([])
  expect(emit).toHaveBeenLastCalledWith([])
  ;(stop as () => void)()
  expect(off).toHaveBeenCalled()
})

const pending = { importId: 'i1', appId: 'fusion', fingerprint: 'f' } as PendingImport
function imports(patch: Partial<AppImports> = {}): Pick<AppImports, 'list' | 'subscribe' | 'accept' | 'drop'> {
  return { list: () => [pending], subscribe: () => () => {}, accept: async () => ({ ok: true, appId: 'fusion' }), drop: async () => {}, ...patch }
}
const call = (connectionId: number) => ({ connection: { id: connectionId } }) as never

it('declares the imports, their stream, acceptImport and dropImport', () => {
  expect(Object.keys(appsCapability.methods).sort()).toEqual(['acceptImport', 'dropImport', 'imports', 'list'])
  expect(Object.keys(appsCapability.streams).sort()).toEqual(['watch', 'watchImports'])
})

it('lists the pending imports, then streams them', () => {
  let listener: ((list: PendingImport[]) => void) | undefined
  const impl = appsCapabilityImpl({ list: () => [], subscribe: () => () => {} }, imports({ subscribe: (l) => { listener = l; return () => {} } }))
  expect(impl.imports(undefined as never, undefined as never)).toEqual([pending])
  const emit = vi.fn()
  impl.watchImports(undefined as never, { emit } as never, undefined as never)
  expect(emit).toHaveBeenCalledWith([pending])
  listener?.([])
  expect(emit).toHaveBeenLastCalledWith([])
})

it('accepts for the calling connection and turns a refusal into a rejected error', async () => {
  const accept = vi.fn<AppImports['accept']>(async () => ({ ok: true, appId: 'fusion' }))
  const impl = appsCapabilityImpl({ list: () => [], subscribe: () => () => {} }, imports({ accept }))
  await expect(impl.acceptImport({ importId: 'i1', fingerprint: 'f', replace: true }, call(7))).resolves.toEqual({ appId: 'fusion' })
  expect(accept).toHaveBeenCalledWith({ importId: 'i1', fingerprint: 'f', replace: true }, { connectionId: 7 })
  accept.mockResolvedValueOnce({ ok: false, error: 'non' })
  await expect(impl.acceptImport({ importId: 'i1', fingerprint: 'f' }, call(7))).rejects.toMatchObject({ code: 'rejected', message: 'non' })
})

it('drops an import', async () => {
  const drop = vi.fn(async () => {})
  const impl = appsCapabilityImpl({ list: () => [], subscribe: () => () => {} }, imports({ drop }))
  await impl.dropImport({ importId: 'i1' }, call(7))
  expect(drop).toHaveBeenCalledWith('i1')
})
