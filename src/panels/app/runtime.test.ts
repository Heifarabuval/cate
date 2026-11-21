import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppPanels } from './runtime'

let base: string
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'app-runtime-')) })
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

const trust = { isTrusted: () => true, onChange: () => () => {} }

it('builds nothing before a session or the daemon needs it', async () => {
  const panels = createAppPanels({ dir: path.join(base, 'panneaux'), grantsFile: path.join(base, 'data', 'app-grants.json'), trust, clientHas: () => true })
  await panels.dispose()
  expect(fs.existsSync(path.join(base, 'panneaux'))).toBe(false)
})

it('logs a panels folder that cannot be created instead of swallowing it, and the daemon stays up', async () => {
  fs.writeFileSync(path.join(base, 'fichier'), 'x')
  const log = { warn: vi.fn() }
  const register = vi.fn()
  const panels = createAppPanels({ dir: path.join(base, 'fichier', 'panneaux'), grantsFile: path.join(base, 'app-grants.json'), trust, clientHas: () => true, log })
  panels.attach({ rpc: { register }, router: { registerService: vi.fn() } })
  expect(register).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(log.warn).toHaveBeenCalled())
  expect(String(log.warn.mock.calls[0].join(' '))).toMatch(/panneaux/)
  await panels.dispose()
})

it('serves the pending imports and their install on apps, the quarantine next to the grants file', async () => {
  const register = vi.fn()
  const registerService = vi.fn()
  const data = path.join(base, 'data')
  const panels = createAppPanels({ dir: path.join(base, 'panneaux'), grantsFile: path.join(data, 'app-grants.json'), trust, clientHas: () => true })
  panels.attach({ rpc: { register }, router: { registerService } })
  const impl = register.mock.calls[0][1]
  // `cate.app.*` lists and stages, never installs (SC-003).
  expect(registerService.mock.calls[0][0].namespace).toBe('app')
  expect(Object.keys(registerService.mock.calls[0][1]).sort()).toEqual(['export', 'import', 'imports', 'list'])
  await vi.waitFor(() => expect(fs.existsSync(path.join(data, 'app-imports'))).toBe(true))
  expect(impl.imports()).toEqual([])
  await expect(impl.acceptImport({ importId: 'inconnu', fingerprint: 'f' }, { connection: { id: 1 } })).rejects.toMatchObject({ code: 'rejected' })
  await panels.dispose()
})
