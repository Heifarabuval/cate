import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AppGrant } from '../contract'
import { createAppGrants } from './grants'

let base: string
let panneaux: string
let file: string
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'app-grants-'))
  panneaux = path.join(base, 'home', '.cate', 'panneaux')
  fs.mkdirSync(panneaux, { recursive: true })
  file = path.join(base, 'data', 'app-grants.json')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

const grant: AppGrant = {
  appId: 'fusion-excel',
  source: 'local',
  manifestFingerprint: 'abc',
  accepted: { files: { read: ['**/*.xlsx'], write: [] }, network: [], links: { receive: [], emit: [] } },
  at: '2026-11-20T10:00:00Z'
}

it('writes a grant to <data>/app-grants.json and reads it back after a restart', async () => {
  const grants = createAppGrants({ file, panneauxDir: panneaux })
  expect(grants.get('fusion-excel')).toBeUndefined()
  grants.grant(grant)
  await grants.flush()
  grants.dispose()
  expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ grants: { 'fusion-excel': grant } })
  const again = createAppGrants({ file, panneauxDir: panneaux })
  expect(again.get('fusion-excel')).toEqual(grant)
  again.dispose()
})

it('revokes a grant', async () => {
  const grants = createAppGrants({ file, panneauxDir: panneaux })
  grants.grant(grant)
  grants.revoke('fusion-excel')
  expect(grants.get('fusion-excel')).toBeUndefined()
  grants.dispose()
})

it('refuses a file inside the panels folder, which a third party controls', () => {
  expect(() => createAppGrants({ file: path.join(panneaux, 'fusion-excel', 'app-grants.json'), panneauxDir: panneaux })).toThrow(/panneaux/)
  expect(() => createAppGrants({ file: path.join(panneaux, 'app-grants.json'), panneauxDir: panneaux })).toThrow(/panneaux/)
})

it('quarantines a corrupt file and assumes no grant', async () => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{ not json')
  const grants = createAppGrants({ file, panneauxDir: panneaux })
  expect(grants.get('fusion-excel')).toBeUndefined()
  expect(fs.readdirSync(path.dirname(file)).some((name) => name.startsWith('app-grants.json.corrupt-'))).toBe(true)
  grants.dispose()
})

it('drops entries of a hand edit that are not grants', () => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ grants: { ok: { ...grant, appId: 'ok' }, bad: { appId: 'bad' }, worse: 3 } }))
  const grants = createAppGrants({ file, panneauxDir: panneaux })
  expect(grants.get('ok')).toBeDefined()
  expect(grants.get('bad')).toBeUndefined()
  expect(grants.get('worse')).toBeUndefined()
  grants.dispose()
})

it('keeps the accepted files of an installed grant across a restart, and drops a grant whose files are not a list of files', async () => {
  const installed: AppGrant = { ...grant, source: 'installed', origin: 'fusion.cate-panneau', folderFingerprint: 'f', files: [{ path: 'index.html', sha256: 'a' }] }
  const first = createAppGrants({ file, panneauxDir: panneaux })
  first.grant(installed)
  await first.flush()
  first.dispose()
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  raw.grants.bad = { ...installed, appId: 'bad', files: [{ path: 3 }] }
  fs.writeFileSync(file, JSON.stringify(raw))
  const second = createAppGrants({ file, panneauxDir: panneaux })
  expect(second.get('fusion-excel')).toEqual(installed)
  expect(second.get('bad')).toBeUndefined()
  second.dispose()
})
