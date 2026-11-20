// The validation inbox end to end (FR-016, SC-001): answer a line of another
// project from the inbox. Two workspaces, each with an agence panel over the
// fake regisseur and fake `gh` (fixtures/agence-fakes.ts); the draft waits in
// the first project, the inbox is opened in the second. The fake regisseur
// only knows drafts, so the line is a draft: Lire et envoyer, then Envoyer.
// Skips, with its reason, when the build has no agence panel: never a false green.

import { test, expect as baseExpect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, makeHome, makeProject } from './fixtures/electron-app'
import { launchWithRuntime } from './fixtures/runtime-install'
import { freePort, hashOf, installAgenceFakes, writeAgenceState, writeDraftText } from './fixtures/agence-fakes'

const expect = baseExpect.configure({ timeout: 30_000 })

let app: ElectronApplication
let page: Page
let home = ''
test.afterEach(async () => closeApp(app, { home }))

const TEXT = '# Corriger le logo\n\nLe logo du bandeau est flou sur mobile.'
const NEED = { id: 'n1', title: 'Valider le brouillon (issue) « Corriger le logo »', ref: 'd1' }
const DRAFT = { id: 'd1', needId: 'n1', cible: 'issue:acme/site', titre: 'Corriger le logo' }

test('answers a draft of another project from the inbox, sent in under 5 s, whole run under 15 s', async () => {
  test.setTimeout(180_000)
  home = makeHome()
  const first = makeProject(home, { name: 'premier' })
  const second = makeProject(home, { name: 'second' })
  const fakes = installAgenceFakes(home)
  writeAgenceState(first, { port: await freePort(), repo: 'premier', needs: [NEED], drafts: [DRAFT] })
  writeDraftText(first, 'd1', TEXT)
  writeAgenceState(second, { port: await freePort(), repo: 'second', needs: [], drafts: [] })
  ;({ electronApp: app, mainWindow: page } = await launchWithRuntime({ home, workspace: first, env: fakes.env }))

  const agence = await page.evaluate(() => window.__cateE2E!.createOnCanvas('agence', { x: 20, y: 20 }))
  test.skip(agence === null, 'le panneau agence est absent de ce build : rien à vérifier, le test ne prouve rien')

  // The second project, trusted and open, with its own agence panel.
  const opened = page.evaluate((root) => window.__cateE2E!.addWorkspace(undefined, root), second)
  await page.locator('[data-workspace-opening]').getByRole('button', { name: 'Trust and open' }).click()
  await opened
  expect(await page.evaluate(() => window.__cateE2E!.createOnCanvas('agence', { x: 20, y: 20 }))).not.toBeNull()
  expect(await page.evaluate(() => window.__cateE2E!.createOnCanvas('boite', { x: 700, y: 20 }))).not.toBeNull()

  const line = page.getByTestId('ligne').filter({ hasText: 'premier' })
  await expect(line).toBeVisible()
  const started = Date.now()
  await line.getByRole('button', { name: 'Lire et envoyer' }).click()
  await line.getByRole('button', { name: 'Envoyer', exact: true }).click()

  await expect.poll(() => fakes.ghCalls().length).toBe(1)
  const [call] = fakes.ghCalls()
  expect(call.args).toEqual(['issue', 'create', '-R', 'acme/site', '--title', 'Corriger le logo', '--body-file', '-'])
  expect(hashOf(call.stdin)).toBe(hashOf(TEXT))
  await expect(line).toHaveCount(0, { timeout: 5_000 })
  expect(Date.now() - started).toBeLessThan(15_000)
})
