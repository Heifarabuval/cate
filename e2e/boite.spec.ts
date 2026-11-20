// The validation inbox end to end (FR-016, SC-001): answer a question of
// another project from the inbox. Two workspaces, each with an agence panel
// over the fake regisseur (fixtures/agence-fakes.ts); the question waits in the
// first project, the inbox is opened in the second. The fake regisseur answers
// a plain question (no merge). Skips, with its reason, when the build has no
// agence panel: never a false green.

import { test, expect as baseExpect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { addCanvas, closeApp, makeHome, makeProject, openWorkspace } from './fixtures/electron-app'
import { launchWithRuntime } from './fixtures/runtime-install'
import { freePort, installAgenceFakes, writeAgenceState } from './fixtures/agence-fakes'

const expect = baseExpect.configure({ timeout: 30_000 })

let app: ElectronApplication
let page: Page
let home = ''
test.afterEach(async () => closeApp(app, { home }))

const NEED = { id: 'n1', title: 'Choisir la base', kind: 'question', ref: 'q1' }
const QUESTION = { id: 'q1', needId: 'n1', question: 'Quelle base ?', options: [{ label: 'Postgres', detail: 'robuste' }, { label: 'SQLite', detail: 'simple' }] }

/** The first click on an unfocused canvas node only focuses it (CanvasNode). */
async function focus(nodeId: string): Promise<void> {
  const overlay = page.locator(`[data-node-id="${nodeId}"] [data-unfocused-overlay]`)
  // Dispatched: the overlay's handler is what matters, not the pixel under the pointer.
  if (await overlay.count()) await overlay.dispatchEvent('click')
}

test('answers a question of another project from the inbox, the line gone in under 5 s, the run under 15 s', async () => {
  test.setTimeout(180_000)
  home = makeHome()
  const first = makeProject(home, { name: 'premier' })
  const second = makeProject(home, { name: 'second' })
  const fakes = installAgenceFakes(home)
  writeAgenceState(first, { port: await freePort(), repo: 'premier', needs: [NEED], drafts: [], questions: [QUESTION] })
  writeAgenceState(second, { port: await freePort(), repo: 'second', needs: [], drafts: [] })
  ;({ electronApp: app, mainWindow: page } = await launchWithRuntime({ home, workspace: first, env: fakes.env }))

  const agence = await page.evaluate(() => window.__cateE2E!.createOnCanvas('agence', { x: 20, y: 20 }))
  test.skip(agence === null, 'le panneau agence est absent de ce build : rien à vérifier, le test ne prouve rien')

  // The second project: opened and trusted, a canvas of its own (a new workspace has none), its agence panel, then the inbox.
  await openWorkspace(page, second)
  await addCanvas(page)
  expect(await page.evaluate(() => window.__cateE2E!.createOnCanvas('agence', { x: 20, y: 20 }))).not.toBeNull()
  const inbox = await page.evaluate(() => window.__cateE2E!.createOnCanvas('boite', { x: 700, y: 20 }))
  expect(inbox).not.toBeNull()

  const line = page.getByTestId('ligne').filter({ hasText: 'premier' })
  await expect(line).toBeVisible()
  await focus(inbox!.nodeId)
  const started = Date.now()
  await line.getByRole('button', { name: 'Répondre' }).first().click()
  await line.getByTestId('option').first().click()

  await expect(line).toHaveCount(0, { timeout: 5_000 })
  expect(Date.now() - started).toBeLessThan(15_000)
  // The regisseur of the first project received exactly this answer.
  expect(fakes.posts().filter((post) => post.path === '/ask/q1' && post.code === 303)).toHaveLength(1)
})
