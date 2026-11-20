import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppEntry } from '@panels/app/contract'
import { AppsPage } from './AppsPage'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const list = vi.hoisted(() => ({ value: null as AppEntry[] | null }))
vi.mock('./useApps', () => ({ useApps: () => list.value }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))
const render = () => act(() => root.render(<AppsPage workspaceId="ws" />))

it('lists ready panels, and the error of a folder in one sentence with its name', () => {
  list.value = [
    { id: 'fusion-excel', status: 'ready', name: 'Fusion Excel', description: 'Fusionne deux Excel.', icon: 'table', size: { width: 900, height: 600 }, warnings: ['champ inconnu ignoré : couleur'], source: 'local' },
    { id: 'casse', status: 'error', error: 'id « autre » différent du nom du dossier « casse »', warnings: [] }
  ]
  render()
  const text = host.textContent ?? ''
  expect(text).toContain('Fusion Excel')
  expect(text).toContain('Fusionne deux Excel.')
  expect(text).toContain('champ inconnu ignoré : couleur')
  expect(text).toContain('casse')
  expect(text).toContain('id « autre » différent du nom du dossier « casse »')
})

it('says where panels live when there is none, and that the workspace is not trusted when blocked', () => {
  list.value = []
  render()
  expect(host.textContent).toContain('~/.cate/panneaux')
  list.value = [{ id: 'a', status: 'blocked', warnings: [] }]
  render()
  expect(host.textContent).toContain('non approuvé')
})
