import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setRuntimeResolver } from '@kernel/rpc/client'
import type { AppEntry } from '@panels/app/contract'
import { useAppMenuEntries } from './menuEntries'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const features = vi.hoisted(() => ({ webview: true }))
const created = vi.hoisted(() => vi.fn())
vi.mock('@client/connections', () => ({ clientHas: (feature: string) => feature !== 'webview' || features.webview }))
vi.mock('../../client/layout/canvas', () => ({ createPanelOnCanvas: created }))

const ready = (id: string, name: string, icon: 'table' | 'layout-dashboard' = 'table'): AppEntry => ({
  id, status: 'ready', name, description: 'Une phrase.', icon, size: { width: 900, height: 600 }, warnings: [], source: 'local'
})

let stop = () => {}
let send: (list: AppEntry[]) => void = () => {}
let root: ReturnType<typeof createRoot>
let seen: ReturnType<typeof useAppMenuEntries> = []

function Probe() {
  seen = useAppMenuEntries('ws', 'canvas-1')
  return null
}

beforeEach(() => {
  features.webview = true
  created.mockClear()
  seen = []
  const watch = vi.fn(() => ({ onEvent: (listener: (list: AppEntry[]) => void) => { send = listener; return () => {} }, cancel: () => {} }))
  stop = setRuntimeResolver((id) => (id === 'ws' ? ({ apps: { watch } } as never) : null))
  root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
})
afterEach(() => {
  act(() => root.unmount())
  stop()
})

const emit = (list: AppEntry[]) => act(() => send(list))

it('offers nothing until the runtime sent the list', () => {
  expect(seen).toEqual([])
})

it('offers one entry per ready panel: its name as label, its icon', () => {
  emit([ready('fusion-excel', 'Fusion Excel'), ready('notes', 'Notes', 'layout-dashboard')])
  expect(seen.map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'app:fusion-excel', label: 'Fusion Excel' },
    { id: 'app:notes', label: 'Notes' }
  ])
  expect(seen.map((entry) => entry.icon)).toEqual(['table', 'layout-dashboard'])
})

it('offers no panel entry for a folder in error, and a new folder adds its entry', () => {
  emit([ready('a', 'A'), { id: 'cassé', status: 'error', error: 'name doit faire de 1 à 40 caractères', warnings: [] }])
  expect(seen.map((entry) => entry.id)).toEqual(['app:a', 'apps:page'])
  emit([ready('a', 'A'), ready('b', 'B')])
  expect(seen.map((entry) => entry.id)).toEqual(['app:a', 'app:b'])
})

it('offers nothing at all while the workspace is not trusted', () => {
  emit([{ id: 'a', status: 'blocked', warnings: [] }, { id: 'b', status: 'blocked', warnings: [] }])
  expect(seen).toEqual([])
})

it('offers nothing on a client without the webview feature', () => {
  features.webview = false
  emit([ready('a', 'A')])
  expect(seen).toEqual([])
})

it('creates an app panel of that folder at the picked point', () => {
  emit([ready('fusion-excel', 'Fusion Excel')])
  seen[0].run({ x: 10, y: 20 })
  expect(created).toHaveBeenCalledWith('ws', 'canvas-1', 'app', { position: { x: 10, y: 20 }, appId: 'fusion-excel', title: 'Fusion Excel', size: { width: 900, height: 600 } })
})

it('adds a "Panneaux perso" entry only while a folder is in error, to read why', () => {
  emit([ready('a', 'A')])
  expect(seen.map((entry) => entry.id)).toEqual(['app:a'])
  emit([ready('a', 'A'), { id: 'casse', status: 'error', error: 'JSON invalide', warnings: [] }])
  expect(seen.map((entry) => entry.label)).toEqual(['A', 'Panneaux perso'])
  seen[1].run({ x: 1, y: 2 })
  expect(created).toHaveBeenLastCalledWith('ws', 'canvas-1', 'app', { position: { x: 1, y: 2 }, title: 'Panneaux perso' })
})
