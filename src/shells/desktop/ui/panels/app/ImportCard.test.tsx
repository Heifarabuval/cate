import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setRuntimeResolver } from '@kernel/rpc/client'
import type { RuntimeProxy } from '@kernel/rpc/contract'
import { installClientUi } from '@kernel/interaction'
import type { ClientUi } from '@kernel/interaction/contract'
import type { AppManifest, PendingImport } from '@panels/app/contract'
import { ImportCard } from './ImportCard'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const manifest = (permissions: Partial<AppManifest['permissions']> = {}): AppManifest => ({
  schema: 1, id: 'fusion-excel', name: 'Fusion Excel', description: 'Fusionne deux Excel.', icon: 'table', entry: 'index.html',
  size: { width: 900, height: 600 }, tasks: [],
  permissions: { files: { read: [], write: [] }, network: [], links: { receive: [], emit: [] }, ...permissions }
} as unknown as AppManifest)

const pending = (patch: Partial<PendingImport> = {}): PendingImport => ({
  importId: 'imp-1', appId: 'fusion-excel', manifest: manifest(), source: 'fusion.cate-panneau',
  fingerprint: '0123456789abcdef0123456789abcdef', files: 3, size: 2048, at: '2026-11-21T00:00:00.000Z', ...patch
})

let host: HTMLDivElement
let root: Root
let stop: () => void
const acceptImport = vi.fn(async (_params: unknown) => ({ appId: 'fusion-excel' }))
const dropImport = vi.fn(async (_params: unknown) => undefined)
const confirm = vi.fn(async (_message: string) => true)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  acceptImport.mockClear(); dropImport.mockClear(); confirm.mockClear()
  stop = setRuntimeResolver(() => ({ apps: { acceptImport, dropImport } }) as unknown as RuntimeProxy)
  installClientUi({ confirm } as unknown as ClientUi)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  stop()
})

const render = (item: PendingImport) => act(() => root.render(<ImportCard workspaceId="ws" item={item} />))
const text = () => host.textContent ?? ''
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
const click = (label: string) => act(async () => { button(label)!.click() })
const alerts = () => [...host.querySelectorAll('[data-alert]')].map((node) => node.textContent)

it('shows what the import is and asks: name, description, source, fingerprint start, files, permissions sentence', () => {
  render(pending({ manifest: manifest({ network: ['api.exemple.fr'] }) }))
  expect(text()).toContain('Fusion Excel')
  expect(text()).toContain('Fusionne deux Excel.')
  expect(text()).toContain('fusion.cate-panneau')
  expect(text()).toContain('0123456789ab')
  expect(text()).not.toContain('0123456789abc')
  expect(text()).toContain('3 fichiers')
  expect(text()).toContain('2,0 Ko')
  expect(text()).toContain('Les fichiers que vous choisissez ici peuvent être envoyés à api.exemple.fr.')
})

it('Installer sends acceptImport with the fingerprint of the card; Annuler sends dropImport', async () => {
  render(pending())
  await click('Installer')
  expect(acceptImport).toHaveBeenCalledWith({ importId: 'imp-1', fingerprint: '0123456789abcdef0123456789abcdef' })
  await click('Annuler')
  expect(dropImport).toHaveBeenCalledWith({ importId: 'imp-1' })
})

it('raises a red alert when readable files go with a network, and for a loopback host', () => {
  render(pending({ manifest: manifest({ files: { read: ['*.xlsx'], write: [] }, network: ['api.exemple.fr'] }) }))
  expect(alerts()).toHaveLength(1)
  expect(alerts()[0]).toContain('fichiers')
  for (const host of ['localhost', '127.0.0.1', '[::1]', '*.localhost', 'localhost:3000']) {
    render(pending({ manifest: manifest({ network: [host] }) }))
    expect(alerts(), host).toHaveLength(1)
    expect(alerts()[0], host).toContain('votre machine')
  }
})

it('raises no alert for a manifest without network', () => {
  render(pending({ manifest: manifest({ files: { read: ['*.xlsx'], write: [] } }) }))
  expect(alerts()).toEqual([])
  expect(text()).toContain('Il ne peut pas utiliser internet.')
})

it('a replacement shows the diff, names what it replaces, and Remplacer is not the primary button', async () => {
  render(pending({ replaces: 'installed', diff: { added: ['neuf.js'], changed: ['app.js'], removed: ['vieux.css'] } }))
  expect(text()).toContain('remplace un panneau installé')
  expect(text()).toContain('neuf.js')
  expect(text()).toContain('app.js')
  expect(text()).toContain('vieux.css')
  expect(button('Installer')).toBeUndefined()
  expect(button('Remplacer')!.className).not.toContain('bg-focus-blue')
  await click('Remplacer')
  expect(confirm).not.toHaveBeenCalled()
  expect(acceptImport).toHaveBeenCalledWith({ importId: 'imp-1', fingerprint: '0123456789abcdef0123456789abcdef', replace: true })
})

it('asks before replacing the user’s own local panel, and does nothing when they say no', async () => {
  render(pending({ replaces: 'local', diff: { added: [], changed: ['app.js'], removed: [] } }))
  expect(text()).toContain('remplace votre panneau local')
  confirm.mockResolvedValueOnce(false)
  await click('Remplacer')
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(acceptImport).not.toHaveBeenCalled()
  await click('Remplacer')
  expect(acceptImport).toHaveBeenCalledWith({ importId: 'imp-1', fingerprint: '0123456789abcdef0123456789abcdef', replace: true })
})

it('a refusal of the runtime (fingerprint changed) shows its sentence and installs nothing', async () => {
  acceptImport.mockRejectedValueOnce(new Error('l’empreinte ne correspond pas à la carte : relire la carte'))
  render(pending())
  await click('Installer')
  expect(text()).toContain('l’empreinte ne correspond pas à la carte')
  expect(button('Installer')!.disabled).toBe(false)
})
