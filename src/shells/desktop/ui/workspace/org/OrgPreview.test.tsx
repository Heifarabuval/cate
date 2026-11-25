import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setRuntimeResolver } from '@kernel/rpc/client'
import type { RuntimeProxy } from '@kernel/rpc/contract'
import { ORG_DUO, type LoadedOrg } from '@workspace/org/contract'
import { OrgPreviewView } from './OrgPreview'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let removeRuntime: (() => void) | undefined

const capacity = (ceiling: number) => ({ ceiling, live: 0, availableMb: 0, reserveMb: 0, avgAgentMb: 2048, canStart: true, reason: null })
const installRuntime = (load: LoadedOrg, ceiling = 4) => {
  const runtime = { org: { load: async () => load }, power: { capacity: async () => capacity(ceiling) } } as unknown as RuntimeProxy
  removeRuntime = setRuntimeResolver((id) => (id === 'ws' ? runtime : null))
}
const render = (workspaceId = 'ws') => act(async () => root.render(<OrgPreviewView workspaceId={workspaceId} />))

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  removeRuntime?.()
  removeRuntime = undefined
  vi.useRealTimers()
})

const change = async (label: string, value: string) => {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const roles = () => [...host.querySelectorAll('[data-role]')].map((n) => n.getAttribute('data-role'))

it('draws one node per role, one arrow per link, clicks marked', async () => {
  await act(async () => root.render(<OrgPreviewView workspaceId="ws" />))
  await change('Org', 'agency')
  expect(roles()).toEqual(['po', 'front', 'back', 'qa', 'gcp'])
  expect(host.querySelectorAll('[data-link]')).toHaveLength(5)
  expect(host.querySelectorAll('[data-click="before"]')).toHaveLength(3)
  expect(host.querySelectorAll('[data-click="after"]')).toHaveLength(2)
  expect(host.querySelector('[data-cost="agents"]')!.textContent).toBe('3 / 4')
})

it('shows the defects of the org', async () => {
  await act(async () => root.render(<OrgPreviewView workspaceId="ws" />))
  await change('Org', 'duo')
  expect(host.querySelector('[data-defect="no-validator"]')!.textContent).toContain('no validator')
  await change('Org', 'solo')
  expect(host.textContent).toContain('No defect.')
})

it('flags the real ceiling of the machine when it is too low', async () => {
  installRuntime({ ok: true, source: 'solo', org: ORG_DUO }, 2)
  await render()
  await change('Org', 'agency')
  expect(host.querySelector('[data-defect="over-memory"]')).not.toBeNull()
})

it('compares two orgs side by side', async () => {
  await act(async () => root.render(<OrgPreviewView workspaceId="ws" />))
  await change('Compare with', 'agency')
  expect(host.querySelectorAll('section[aria-label^="Org "]')).toHaveLength(2)
})

it('plays the typical task step by step', async () => {
  await act(async () => root.render(<OrgPreviewView workspaceId="ws" />))
  await change('Org', 'duo')
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Simulate'))!
  await act(async () => button.click())
  expect(host.querySelector('[data-testid="step"]')!.textContent).toBe('')
  await act(async () => { await vi.advanceTimersByTimeAsync(900) })
  expect(host.querySelector('[data-role="dev"]')!.getAttribute('data-active')).toBe('true')
  await act(async () => { await vi.advanceTimersByTimeAsync(900) })
  expect(host.querySelector('[data-role="reviewer"]')!.getAttribute('data-active')).toBe('true')
  await act(async () => { await vi.advanceTimersByTimeAsync(900) })
  expect(host.querySelector('[data-link="0"]')!.getAttribute('data-active')).toBe('true')
})

it('shows the workspace org first, the solo profile when there is no file', async () => {
  installRuntime({ ok: true, source: 'solo', org: ORG_DUO })
  await render()
  expect(roles()).toEqual(['dev', 'reviewer'])
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="Org"]')!.textContent).toContain('This workspace')
  await change('Org', 'agency')
  expect(roles()).toHaveLength(5)
})

it('shows the errors of an invalid org file and keeps the examples', async () => {
  installRuntime({ ok: false, errors: ['.cate/org.json is not valid JSON: boom'] })
  await render()
  expect(host.querySelector('[data-org-error]')!.textContent).toContain('not valid JSON')
  expect(host.querySelector('select[aria-label="Org"] option[value="workspace"]')).toBeNull()
  expect(roles()).toEqual(['dev'])
})
