import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppOp, AppSnapshot } from '@panels/app/contract'
import AppPanel from './AppPanel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./AppWebview', () => ({ AppWebview: ({ url }: { url: string }) => <div data-testid="webview">{url}</div> }))
vi.mock('./AppsPage', () => ({ AppsPage: () => <div data-testid="apps-page" /> }))

const snapshot = (patch: Partial<AppSnapshot> = {}): AppSnapshot => ({
  appId: 'fusion-excel', name: 'Fusion Excel', state: 'needs-grant', url: null,
  sentence: '« Fusion Excel » s’exécute dans un cadre isolé, sans accès à vos fichiers. Il ne peut pas utiliser internet.',
  message: null, reload: 0, fingerprint: 'fp-1', ...patch
})

let host: HTMLDivElement
let root: Root
let send: ReturnType<typeof vi.fn<(op: AppOp) => Promise<unknown>>>

function render(snap: AppSnapshot | null) {
  const props = { workspaceId: 'ws', panelId: 'p1', snapshot: snap, send, visible: true, focused: false } as unknown as React.ComponentProps<typeof AppPanel>
  act(() => root.render(<AppPanel {...props} />))
}
const text = () => host.textContent ?? ''
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  send = vi.fn(async () => undefined)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('shows the grant card and mounts no page until Autoriser', () => {
  render(snapshot())
  expect(text()).toContain('Panneau perso : fusion-excel')
  expect(text()).toContain('Il ne peut pas utiliser internet.')
  expect(host.querySelector('[data-testid="webview"]')).toBeNull()
  act(() => button('Autoriser').click())
  expect(send).toHaveBeenCalledWith({ kind: 'grant', fingerprint: 'fp-1' })
})

it('Refuser sends the refuse op and mounts nothing', () => {
  render(snapshot())
  act(() => button('Refuser').click())
  expect(send).toHaveBeenCalledWith({ kind: 'refuse' })
  expect(host.querySelector('[data-testid="webview"]')).toBeNull()
})

it('mounts the page in its frame once running, under the name and the origin of the panel', () => {
  render(snapshot({ state: 'running', url: 'http://127.0.0.1:9/t/fusion-excel/index.html', sentence: null }))
  expect(host.querySelector('[data-testid="webview"]')?.textContent).toBe('http://127.0.0.1:9/t/fusion-excel/index.html')
  expect(text()).toContain('Fusion Excel')
  expect(text()).toContain('Panneau perso : fusion-excel')
  expect(host.querySelector('button')).toBeNull()
})

it('says the panel is missing, blocked or in error, and mounts no page', () => {
  render(snapshot({ state: 'missing', name: null, sentence: null, message: 'Panneau perso introuvable' }))
  expect(text()).toContain('Panneau perso introuvable')
  render(snapshot({ state: 'blocked', name: null, sentence: null, message: 'Workspace non approuvé : les panneaux perso ne se chargent pas.' }))
  expect(text()).toContain('Workspace non approuvé')
  render(snapshot({ state: 'error', name: null, sentence: null, message: 'version de format inconnue' }))
  expect(text()).toContain('version de format inconnue')
  expect(host.querySelector('[data-testid="webview"]')).toBeNull()
})

it('keeps the running page and shows the manifest error as a banner', () => {
  render(snapshot({ state: 'running', url: 'http://127.0.0.1:9/t/x', sentence: null, message: 'cate-panel.json n’est pas du JSON valide' }))
  expect(host.querySelector('[data-testid="webview"]')).not.toBeNull()
  expect(text()).toContain('JSON valide')
})

it('without an app id the panel is the page of the custom panels', () => {
  render(snapshot({ appId: '', name: null, state: 'missing', sentence: null }))
  expect(host.querySelector('[data-testid="apps-page"]')).not.toBeNull()
})

it('waits for the first snapshot', () => {
  render(null)
  expect(host.querySelector('[data-testid="webview"]')).toBeNull()
  expect(text()).toContain('Chargement')
})
