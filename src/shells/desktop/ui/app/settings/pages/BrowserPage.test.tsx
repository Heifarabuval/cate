import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useEffect } from 'react'
import { createMemoryDeviceStore } from '@kernel/state/contract'
import { createClientSettingsStore } from '@kernel/settings/client'
import { installClientSettings } from '../../../kernel/settings'
import { installDesktopPort, type DesktopPort } from '../../desktop'
import { clientSettingsTable } from '../../../../settings'
import { BrowserPage } from './clientPages'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  installClientSettings(null)
  installDesktopPort(null)
})

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const sharedField = () => host.querySelector<HTMLInputElement>('input[placeholder="google.com, github.com"]')!

// Stands for the browser panels: one entry per panel, counting mounts and unmounts.
const lifecycle: string[] = []
function FakeBrowserPanel({ id }: { id: string }): null {
  useEffect(() => { lifecycle.push(`mount ${id}`); return () => { lifecycle.push(`unmount ${id}`) } }, [id])
  return null
}

async function mountPage() {
  const device = createMemoryDeviceStore()
  const store = createClientSettingsStore(device, clientSettingsTable)
  await store.load()
  installClientSettings(store)
  lifecycle.length = 0
  await act(async () => { root.render(<><FakeBrowserPanel id="b1" /><FakeBrowserPanel id="b2" /><BrowserPage /></>) })
  return { device, store }
}

describe('shared sign-in domains field', () => {
  it('adding a domain leaves the open browser panels mounted', async () => {
    const { store } = await mountPage()
    const panels = () => lifecycle.filter((e) => e.startsWith('mount')).length - lifecycle.filter((e) => e.startsWith('unmount')).length
    expect(panels()).toBe(2)
    act(() => { sharedField().focus() })
    type(sharedField(), 'google.com, github.com, sftp-admin.adfinitas.io')
    await act(async () => { sharedField().blur() })
    expect(store.get('browserSharedSignInDomains')).toEqual(['google.com', 'github.com', 'sftp-admin.adfinitas.io'])
    expect(lifecycle).toEqual(['mount b1', 'mount b2'])
  })

  it('keeps what is typed when the device settings document is re-delivered unchanged', async () => {
    const { device, store } = await mountPage()
    type(sharedField(), 'google.com, github.com, sftp')
    // Another window (or the echo of an earlier write) delivers the same document again.
    await act(async () => { device.change('settings', store.getAll()) })
    type(sharedField(), 'google.com, github.com, sftp-admin.adfinitas.io')
    expect(sharedField().value).toBe('google.com, github.com, sftp-admin.adfinitas.io')
  })
})

describe('import warning', () => {
  it('shows the agent warning before the confirmation button, and reads nothing until it is clicked', async () => {
    const importBrowserSignIns = vi.fn(async () => ({ browser: 'Arc', imported: 3 }))
    installDesktopPort({ defaultBrowserName: async () => 'Arc', importBrowserSignIns } as unknown as DesktopPort)
    await mountPage()
    const button = () => [...host.querySelectorAll('button')].find((b) => /^(Import|Copy from)/.test(b.textContent ?? ''))!
    const warning = () => [...host.querySelectorAll('*')].find((e) => e.children.length === 0 && /acts with every imported session/.test(e.textContent ?? ''))
    expect(warning()).toBeUndefined()

    await act(async () => { button().click() })
    expect(importBrowserSignIns).not.toHaveBeenCalled()
    expect(button().textContent).toBe('Copy from Arc')
    expect(warning()).toBeDefined()
    expect(warning()!.textContent).toMatch(/bank, mail, admin/)
    expect(warning()!.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => { button().click() })
    expect(importBrowserSignIns).toHaveBeenCalledTimes(1)
  })
})
