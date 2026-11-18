// The agence panel end to end: a real daemon and a real panel over a fake
// `agence` regisseur and a fake `gh` (fixtures/agence-fakes.ts), never the real
// tools nor GitHub. The state the CLI keeps is written by the test; the panel
// reads it, and Lire et envoyer then Envoyer goes through the regisseur's form
// to the fake `gh`.

import { test, expect as baseExpect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { closeApp, makeHome, makeProject } from './fixtures/electron-app'
import { launchWithRuntime } from './fixtures/runtime-install'
import { freePort, hashOf, installAgenceFakes, writeAgenceState, writeDraftText, type AgenceFakes } from './fixtures/agence-fakes'

// Every wait is 30 s, as the polls of this file: a send goes through a spawned
// node, the local network and the panel's refresh cycle (the default is 5 s).
const expect = baseExpect.configure({ timeout: 30_000 })

/** Under this width the panel shows the follow-up as a tab (`NARROW_PX` of AgenceView.tsx). */
const NARROW_PX = 640

let app: ElectronApplication
let page: Page
let home = ''
let root = ''
let fakes: AgenceFakes
let port = 0
let nodeId = ''
/** The width the test gave the panel's root: what decides columns or tabs. */
let panelWidth = 0

const TEXT = '# Corriger le logo\n\nLe logo du bandeau est flou sur mobile.\n\n- reproduire à 375 px\n- servir le SVG'
const TARGET = 'issue:acme/site'
const NEED = { id: 'n1', title: 'Valider le brouillon (issue) « Corriger le logo »', ref: 'd1' }
const DRAFT = { id: 'd1', needId: 'n1', cible: TARGET, titre: 'Corriger le logo' }

const state = (extra: { drafts?: Array<typeof DRAFT & { statut?: string }>; needs?: Array<typeof NEED & { status?: string }> } = {}) =>
  writeAgenceState(root, { port, needs: extra.needs ?? [NEED], drafts: extra.drafts ?? [DRAFT] })

async function launch(opts: { mode?: 'old'; withState?: boolean } = {}): Promise<void> {
  home = makeHome()
  root = makeProject(home)
  fakes = installAgenceFakes(home, opts.mode ? { mode: opts.mode } : {})
  port = await freePort()
  if (opts.withState !== false) { state(); writeDraftText(root, 'd1', TEXT) }
  ;({ electronApp: app, mainWindow: page } = await launchWithRuntime({ home, workspace: root, env: fakes.env }))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1500, 1000); w.show() })
}
test.afterEach(async () => closeApp(app, { home }))

interface Snapshot {
  orchestrator: string
  regisseur: { state: string; error: string | null }
  drafts: Record<string, { statut: string; hash: string; texte: string }>
}

/** Creates the agence panel on the canvas, `width` wide, and waits for it to render. */
async function openAgence(width = 1000): Promise<string> {
  const created = await page.evaluate(() => window.__cateE2E!.createOnCanvas('agence', { x: 20, y: 20 }))
  expect(created).not.toBeNull()
  nodeId = created!.nodeId
  await resize(nodeId, width)
  await expect(page.getByTestId('suivi-column').or(page.getByRole('tab', { name: 'Suivi' }))).toBeAttached()
  await focusPanel()
  return created!.panelId
}

/** The first click on an unfocused canvas panel only focuses it. */
async function focusPanel(): Promise<void> {
  const overlay = page.locator(`[data-node-id="${nodeId}"] [data-unfocused-overlay]`)
  // Dispatched: the terminal's link layer may sit over the overlay's pixels, the handler is the overlay's.
  if (await overlay.count()) await overlay.dispatchEvent('click')
}

/** A click inside the panel, which may have lost the focus since. */
async function press(target: Locator): Promise<void> {
  await focusPanel()
  await target.click()
}

async function resize(nodeId: string, width: number, height = 640): Promise<void> {
  panelWidth = width
  await page.evaluate(({ nodeId, width, height }) => {
    const doc = window.__cateE2E!.document() as unknown as { canvases: Record<string, { id: string; nodes: Record<string, { rect: { origin: { x: number; y: number } } }> }> }
    const canvas = Object.values(doc.canvases).find((c) => c.nodes[nodeId])!
    window.__cateE2E!.propose({ kind: 'setNodeRects', canvasId: canvas.id, rects: [{ nodeId, rect: { origin: canvas.nodes[nodeId].rect.origin, size: { width, height } } }] } as never)
  }, { nodeId, width, height })
  await expect.poll(() => root$().evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0)).toBeGreaterThan(0)
}

/** The panel's root element. */
const root$ = () => page.getByTestId('agence-root')

const snapshot = (panelId: string) => page.evaluate((id) => window.__cateE2E!.sessionSnapshot(id), panelId) as Promise<Snapshot>
const sendOp = (panelId: string, op: unknown) => page.evaluate(({ id, op }) => window.__cateE2E!.sessionOp(id, op), { id: panelId, op }) as Promise<{ ok: boolean; error?: string; message?: string }>
const stateFile = () => JSON.parse(readFileSync(path.join(root, '.cate', 'tmp', 'agence', 'state.json'), 'utf8')) as { drafts: Array<{ id: string; statut: string; url: string | null }>; needs: Array<{ id: string; status: string; evidence: string | null }> }

/** Brings the follow-up in view. The layout follows the root's width (tabs under
 *  NARROW_PX, columns above) a frame after a resize, so each branch waits, with
 *  the auto-retried assertions, for the layout the width calls for. */
async function showSuivi(): Promise<void> {
  if (panelWidth < NARROW_PX) {
    const tab = page.getByRole('tab', { name: 'Suivi' })
    await expect(tab).toBeVisible()
    await press(tab)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  } else {
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.getByTestId('suivi-column')).toBeVisible()
  }
}

async function readDraft(): Promise<void> {
  await showSuivi()
  await press(page.getByRole('button', { name: 'Lire et envoyer' }))
  await expect(page.getByTestId('draft-actions')).toBeVisible()
}

/** The regisseur's fake processes of this test. */
const regisseurPids = (): number[] => {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
      .filter((line) => line.includes(path.join(home, 'fake-checkout')) && line.includes('fake-agence.cjs') && line.includes('watch'))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
  } catch { return [] }
}

test('Lire et envoyer shows the draft under À faire, then sends exactly that text to its target', async () => {
  test.setTimeout(180_000)
  await launch()
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')

  // « À faire » holds the draft's need, with its button.
  await expect(page.getByText('À faire par Heifara (1)')).toBeVisible()
  await expect(page.getByTestId('need-title')).toHaveText(NEED.title)
  await readDraft()

  // The text on screen is the text whose hash goes with Envoyer.
  await expect(page.getByRole('heading', { name: 'Corriger le logo', description: 'Corriger le logo' })).toBeVisible()
  await expect(page.getByText(`Issue · ${TARGET} · à valider`)).toBeVisible()
  const preview = page.getByTestId('markdown-preview')
  await expect(preview).toContainText('Le logo du bandeau est flou sur mobile.')
  await expect(preview).toContainText('servir le SVG')
  const shown = (await snapshot(panelId)).drafts.d1
  expect(shown.hash).toBe(hashOf(TEXT))
  expect(shown.texte.trim()).toBe(TEXT)

  await press(page.getByRole('button', { name: 'Envoyer', exact: true }))

  // One gh call, to the draft's target, with the text that was shown.
  await expect.poll(() => fakes.ghCalls().length).toBe(1)
  const [call] = fakes.ghCalls()
  expect(call.args).toEqual(['issue', 'create', '-R', 'acme/site', '--title', 'Corriger le logo', '--body-file', '-'])
  expect(hashOf(call.stdin)).toBe(shown.hash)

  // The draft is « envoyé », its need done with the link as proof, and the panel is back on the list.
  await expect.poll(() => stateFile().drafts[0].statut).toBe('envoyé')
  expect(stateFile().drafts[0].url).toBe('https://github.com/acme/site/issues/42')
  expect(stateFile().needs[0]).toMatchObject({ status: 'done', evidence: 'https://github.com/acme/site/issues/42' })
  await expect(page.getByText('À faire par Heifara (0)')).toBeVisible()
  await expect(page.getByText('Fait (1)')).toBeVisible()
  await expect(page.getByText('preuve : https://github.com/acme/site/issues/42')).toBeVisible()
  await expect.poll(async () => Object.keys((await snapshot(panelId)).drafts)).toEqual([])
})

test('a double click on Envoyer sends once', async () => {
  test.setTimeout(180_000)
  await launch()
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')
  await readDraft()
  await focusPanel()
  await page.getByRole('button', { name: 'Envoyer', exact: true }).dblclick()
  await expect.poll(() => stateFile().drafts[0].statut).toBe('envoyé')
  await expect(page.getByText('Fait (1)')).toBeVisible()
  // The fake regisseur would answer a second send with a 409 and hide it from gh:
  // count what it received, the panel's own guard is what keeps it at one.
  expect(fakes.posts().filter((post) => post.path === '/draft/d1/send')).toHaveLength(1)
  expect(fakes.ghCalls()).toHaveLength(1)
})

test('creating an agence panel opens one panel, with one regisseur and no Régisseur or Suivi panel', async () => {
  test.setTimeout(180_000)
  await launch()
  const before = await page.evaluate(() => window.__cateE2E!.panels().map((p) => p.id))
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')

  const added = await page.evaluate((ids) => window.__cateE2E!.panels().filter((p) => !ids.includes(p.id)).map((p) => ({ id: p.id, type: p.type, title: p.title })), before)
  expect(added).toEqual([{ id: panelId, type: 'agence', title: 'Agence' }])
  expect(added.map((p) => p.title).join(' ')).not.toMatch(/Régisseur|Suivi/)
  expect(await page.getByTestId('suivi-column').count()).toBe(1)
  expect(regisseurPids()).toHaveLength(1)
  expect(await snapshot(panelId)).toMatchObject({ regisseur: { state: 'running' } })
})

test('refusals of the regisseur are shown as they are and nothing is sent', async () => {
  test.setTimeout(180_000)
  await launch()
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')
  await readDraft()
  const envoyer = page.getByRole('button', { name: 'Envoyer', exact: true })

  // The wording of the regisseur's `click()` (agence.py), per refusal.
  const refusals: Array<[string, string]> = [
    ['Le texte a changé depuis son affichage : recharge la page, relis, puis Envoyer.', "Le texte a changé, relis avant d'envoyer."],
    ['Ce brouillon est déjà « envoyé ».', 'Ce brouillon est déjà « envoyé ».'],
    ["Ce brouillon n'est plus attendu (besoin clos).", "Ce brouillon n'est plus attendu (besoin clos)."],
  ]
  for (const [said, shown] of refusals) {
    fakes.refuseDraft('d1', said)
    await press(envoyer)
    await expect(page.getByText(shown, { exact: true })).toBeVisible()
    await expect(page.getByTestId('draft-actions')).toBeVisible()
  }
  expect(fakes.ghCalls()).toEqual([])
  expect(stateFile().drafts[0].statut).toBe('à valider')
})

test('a refusal by gh is shown, the draft stays to validate and sends once gh works', async () => {
  test.setTimeout(180_000)
  await launch()
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state).toBe('running')
  await readDraft()
  const envoyer = page.getByRole('button', { name: 'Envoyer', exact: true })

  fakes.failGh('GraphQL: Could not resolve to a Repository')
  await press(envoyer)
  await expect(page.getByText('Envoi refusé par GitHub : GraphQL: Could not resolve to a Repository', { exact: true })).toBeVisible()
  // gh was called and failed: the draft is back to « à valider », its need open, and the reader stays.
  expect(fakes.ghCalls()).toHaveLength(1)
  await expect(page.getByTestId('draft-actions')).toBeVisible()
  expect(stateFile().drafts[0]).toMatchObject({ statut: 'à valider', url: null })
  expect(stateFile().needs[0]).toMatchObject({ status: 'open', evidence: null })

  // Once gh works again the same draft goes out, with the text that was shown.
  fakes.failGh(null)
  await press(envoyer)
  await expect.poll(() => stateFile().drafts[0].statut).toBe('envoyé')
  expect(fakes.ghCalls()).toHaveLength(2)
  expect(hashOf(fakes.ghCalls()[1].stdin)).toBe(hashOf(TEXT))
})

test('the regisseur refuses a stale hash, a draft already being sent and a closed need; an unknown draft never reaches it', async () => {
  test.setTimeout(180_000)
  await launch()
  writeAgenceState(root, {
    port,
    needs: [NEED, { id: 'n2', title: 'Envoi en cours', ref: 'd2' }, { id: 'n3', title: 'Besoin clos', ref: 'd3', status: 'done' }],
    // « envoyer » is the regisseur's own « being sent » (it sets it while it sends); « envoyé » drafts are not offered to the session at all.
    drafts: [DRAFT, { ...DRAFT, id: 'd2', needId: 'n2', statut: 'envoyer' }, { ...DRAFT, id: 'd3', needId: 'n3' }],
  })
  for (const id of ['d2', 'd3']) writeDraftText(root, id, TEXT)
  const panelId = await openAgence()
  await expect.poll(async () => Object.keys((await snapshot(panelId)).drafts).length, { timeout: 30_000 }).toBe(3)
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state).toBe('running')

  const stale = await sendOp(panelId, { kind: 'draft.send', draftId: 'd1', hash: hashOf('un autre texte') })
  expect(stale).toMatchObject({ ok: false, error: 'conflict' })
  expect(stale.message).toContain('Le texte a changé')
  const sending = await sendOp(panelId, { kind: 'draft.send', draftId: 'd2', hash: hashOf(TEXT) })
  expect(sending).toMatchObject({ ok: false, error: 'conflict', message: 'Ce brouillon est déjà « envoyer ».' })
  const closed = await sendOp(panelId, { kind: 'draft.send', draftId: 'd3', hash: hashOf(TEXT) })
  expect(closed).toMatchObject({ ok: false, error: 'conflict', message: "Ce brouillon n'est plus attendu (besoin clos)." })
  // An id the state does not hold is refused by the session itself: no request is made.
  const postsBefore = fakes.posts().length
  expect(await sendOp(panelId, { kind: 'draft.send', draftId: 'd9', hash: 'x' })).toMatchObject({ ok: false, error: 'invalid' })
  expect(fakes.posts()).toHaveLength(postsBefore)
  expect(fakes.ghCalls()).toEqual([])
})

test('a regisseur that stopped is explained and restarts from the panel', async () => {
  test.setTimeout(180_000)
  await launch({ withState: false })
  const panelId = await openAgence()
  // No state, no port: the fake regisseur exits and the banner says why.
  const banner = page.getByTestId('regisseur-banner')
  await expect(banner).toContainText('Le régisseur est arrêté', { timeout: 30_000 })
  await expect(banner).toContainText('pas de port')
  await expect(page.getByText('Aucun suivi pour l\'instant.')).toBeVisible()
  await expect(page.getByTestId('conversation-column')).toBeAttached()
  expect(await snapshot(panelId)).toMatchObject({ regisseur: { state: 'stopped' } })

  // The orchestrator wrote the state: Relancer le régisseur starts it again.
  state()
  writeDraftText(root, 'd1', TEXT)
  await press(banner.getByRole('button', { name: 'Relancer le régisseur' }))
  await expect(banner).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText('À faire par Heifara (1)')).toBeVisible()
  expect(regisseurPids()).toHaveLength(1)
})

test('a regisseur killed while a draft is read refuses the send without crashing', async () => {
  test.setTimeout(180_000)
  await launch()
  const panelId = await openAgence()
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')
  await readDraft()
  for (const pid of regisseurPids()) process.kill(pid, 'SIGKILL')
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('stopped')

  await press(page.getByRole('button', { name: 'Envoyer', exact: true }))
  await expect(page.getByText(/Régisseur indisponible/)).toBeVisible()
  await expect(page.getByTestId('regisseur-banner')).toContainText('Le régisseur est arrêté')
  await expect(page.getByTestId('draft-actions')).toBeVisible()
  expect(fakes.ghCalls()).toEqual([])
})

test('an agence too old for the panel is reported, not a crash', async () => {
  test.setTimeout(180_000)
  await launch({ mode: 'old' })
  const panelId = await openAgence()
  await expect(page.getByTestId('regisseur-banner')).toContainText("L'outil agence est introuvable ou trop ancien", { timeout: 30_000 })
  await expect(page.getByTestId('regisseur-banner')).toContainText('unrecognized arguments')
  expect(await snapshot(panelId)).toMatchObject({ regisseur: { state: 'missing' }, drafts: {} })
  // Nothing is offered to act on.
  await showSuivi()
  await expect(page.getByRole('button', { name: 'Lire et envoyer' })).toHaveCount(0)
})

test('the panel reads in light and dark at 320, 834 and 1280 px', async () => {
  test.setTimeout(240_000)
  await launch()
  const panelId = await openAgence(1280)
  await expect.poll(async () => (await snapshot(panelId)).regisseur.state, { timeout: 30_000 }).toBe('running')

  for (const theme of ['light-subtle', 'dark-cold']) {
    await page.evaluate((id) => window.__cateE2E!.setTheme(id), theme)
    for (const width of [320, 834, 1280]) {
      // A canvas node is never narrower than the panel's minimum (420 px): the 320 px layout is the panel's own root, narrowed.
      await resize(nodeId, Math.max(width, 420))
      await root$().evaluate((el, w) => { el.style.width = w < 420 ? `${w}px` : ''; el.style.flex = w < 420 ? 'none' : '' }, width)
      panelWidth = width
      await expect.poll(() => root$().evaluate((el, w) => Math.abs(el.getBoundingClientRect().width - w) <= 2, width)).toBe(true)
      for (const view of ['suivi', 'draft'] as const) {
        await showSuivi()
        // The list or the draft is rendered, never both: wait for whichever it is, then go to the view asked.
        const actions = page.getByTestId('draft-actions')
        const read = page.getByRole('button', { name: 'Lire et envoyer' })
        await expect(actions.or(read)).toBeVisible()
        const reading = (await actions.count()) > 0
        if (view === 'suivi' && reading) await press(page.getByRole('button', { name: 'Retour' }))
        if (view === 'draft' && !reading) await press(read)
        const marker = view === 'draft' ? actions : read
        await expect(marker).toBeVisible()
        // Nothing runs off the panel: no horizontal scroll, every visible button inside it.
        const outside = await root$().evaluate((el) => {
          const box = el.getBoundingClientRect()
          const buttons = [...el.querySelectorAll('button')].map((b) => ({ text: b.textContent, r: b.getBoundingClientRect() })).filter(({ r }) => r.width > 0)
          return [el.scrollWidth > el.clientWidth + 1 ? 'root scrolls' : '', ...buttons.filter(({ r }) => r.left < box.left - 1 || r.right > box.right + 1).map(({ text }) => text)].filter(Boolean)
        })
        expect(outside, `${theme} ${width} ${view}`).toEqual([])
        const rootBox = (await root$().boundingBox())!
        const box = (await marker.boundingBox())!
        expect(box.x, `${theme} ${width} ${view}`).toBeGreaterThanOrEqual(rootBox.x - 1)
        expect(box.x + box.width, `${theme} ${width} ${view}`).toBeLessThanOrEqual(rootBox.x + rootBox.width + 1)
        const file = test.info().outputPath(`agence-${theme}-${width}-${view}.png`)
        await page.screenshot({ path: file, clip: rootBox })
        await test.info().attach(`${theme} ${width}px ${view}`, { path: file, contentType: 'image/png' })
      }
    }
  }
})
