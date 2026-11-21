// Importing a custom panel end to end (spec 007, T508): `cate app import` of a
// fixture folder puts it on hold, the import card shows in the custom panels
// page, nothing is in ~/.cate/panneaux/ before the click, Installer copies it,
// and the panel opens running. Written, not run by the agent that wrote it
// (spec 007, constitution X): the person runs it.

import { test, expect as baseExpect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { closeApp, makeHome, makeProject, seedOnCanvas } from './fixtures/electron-app'
import { launchWithRuntime } from './fixtures/runtime-install'
import { runCate } from './fixtures/cate-terminal'

const expect = baseExpect.configure({ timeout: 30_000 })

let app: ElectronApplication
let page: Page
let home = ''
test.afterEach(async () => closeApp(app, { home }))

/** A panel folder outside ~/.cate/panneaux/, as a sender would give it. */
function fixturePanel(dir: string): string {
  const folder = path.join(dir, 'meteo-e2e')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'cate-panel.json'), JSON.stringify({ schema: 1, id: 'meteo-e2e', name: 'Météo e2e', description: 'Un panneau de test.' }))
  writeFileSync(path.join(folder, 'index.html'), '<!doctype html><title>Météo e2e</title><p>ok</p>')
  return folder
}

test('an imported panel is installed only by the click on Installer, then opens running', async () => {
  test.setTimeout(180_000)
  home = makeHome()
  const workspace = realpathSync(makeProject(home))
  const source = fixturePanel(path.join(home, 'recu'))
  const installed = path.join(home, '.cate', 'panneaux', 'meteo-e2e')
  ;({ electronApp: app, mainWindow: page } = await launchWithRuntime({ home, workspace }))

  const terminal = (await seedOnCanvas(page, 'terminal', { x: 20, y: 20 })).panelId
  const staged = await runCate(page, terminal, 'app', 'import', source)
  expect(staged).toMatch(/[0-9a-f]{12}/)
  expect(existsSync(installed)).toBe(false)

  // The custom panels page: an app panel with no appId.
  const pageNode = (await seedOnCanvas(page, 'app', { x: 700, y: 20 })).nodeId
  const card = page.locator(`[data-node-id="${pageNode}"]`).getByText('Météo e2e').locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Il ne peut pas utiliser internet.')
  expect(existsSync(installed)).toBe(false)

  await card.getByRole('button', { name: 'Installer' }).click()
  await expect(card).toHaveCount(0)
  expect(existsSync(path.join(installed, 'index.html'))).toBe(true)

  // Opened, it runs without a second card: the import card was the grant (spec 007 Q3).
  const panel = (await seedOnCanvas(page, 'app', { x: 20, y: 500 }, { appId: 'meteo-e2e' })).nodeId
  await expect(page.locator(`[data-node-id="${panel}"] webview`)).toHaveCount(1)
  await expect(page.locator(`[data-node-id="${panel}"]`).getByRole('button', { name: 'Autoriser' })).toHaveCount(0)
})
