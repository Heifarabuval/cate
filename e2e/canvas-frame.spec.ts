import { test, expect } from '@playwright/test'
import { launchApp, closeApp, addCanvas, seedOnCanvas } from './fixtures/electron-app'
import { installPerfHelpers, waitForBrowserGuest, waitForPty } from './fixtures/perf-helpers'

// The whole journey of issue #9: `cate panel group create` and `add` (the
// `cate.frame.*` methods the CLI calls, reached through the `api` capability
// since the dev bundle ships no `cate` binary), then the frame folded into its
// bar and unfolded, all read from the document and from the canvas. An editor,
// a terminal and a browser go in; the browser keeps its page through the fold.
// Dragging the bar moves the members only; state and fold survive a reload.
test('a frame created through the cate API takes panels, moves, folds and unfolds them intact, and survives a reload', async () => {
  const { electronApp: app, mainWindow: page } = await launchApp()
  try {
    await installPerfHelpers(page)
    const canvas = await addCanvas(page)
    const editor = await seedOnCanvas(page, 'editor', { x: 40, y: 60 })
    const terminal = await seedOnCanvas(page, 'terminal', { x: 40, y: 520 })
    const url = `data:text/html,${encodeURIComponent('<title>Frame page</title><h1>Frame page</h1>')}`
    const browser = await seedOnCanvas(page, 'browser', { x: 700, y: 60 }, { url })
    const outside = await seedOnCanvas(page, 'editor', { x: 700, y: 620 })
    await waitForPty(page, terminal.panelId)
    const guest = await waitForBrowserGuest(page, browser.panelId)
    // Page state that a reload would lose.
    const pageMark = () => app.evaluate(({ webContents }, id) => webContents.fromId(id)?.executeJavaScript('window.__frameMark ?? null') ?? null, guest)
    await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.__frameMark = "kept"'), guest)
    await expect.poll(pageMark).toBe('kept')

    const call = (method: string, args: Record<string, unknown>) => page.evaluate(([m, a]) => window.__cateE2E!.call('api', 'call', { method: m, args: a }), [method, args] as const)
    const frames = () => page.evaluate(() => {
      const canvases = Object.values(window.__cateE2E!.document()!.canvases)
      return canvases.flatMap((c) => Object.values(c.frames ?? {})).map((f) => ({ id: f.id, title: f.title, collapsed: f.collapsed, state: f.state }))
    })

    await call('cate.frame.create', { title: '#n1 e2e', canvas })
    await expect.poll(async () => (await frames()).map((f) => f.title)).toEqual(['#n1 e2e'])
    const [frame] = await frames()
    const bar = page.locator(`[data-frame="${frame.id}"] [data-frame-bar]`)
    await expect(bar.locator('[data-frame-title]')).toHaveText('#n1 e2e')
    await expect(bar.locator('[data-frame-state]')).toHaveAttribute('data-frame-state', 'active')
    await expect(bar.locator('[data-frame-state]')).toHaveText('in progress')

    const members = [editor, terminal, browser]
    for (const member of members) await call('cate.frame.add', { frameId: frame.id, panelId: member.panelId })
    await expect.poll(() => page.evaluate((nodeIds) => {
      const nodes = Object.values(window.__cateE2E!.document()!.canvases).flatMap((c) => Object.values(c.nodes))
      return nodeIds.map((id) => nodes.find((n) => n.id === id)?.frameId ?? null)
    }, members.map((m) => m.nodeId))).toEqual([frame.id, frame.id, frame.id])
    await expect(bar.locator('[data-frame-count]')).toHaveText('3')
    // Three panels side by side: zoom out so the whole frame is on screen.
    await page.evaluate(() => { window.__cateE2E!.setZoom(0.4); window.__cateE2E!.setViewport({ x: 0, y: 40 }) })
    // The state pill, at the bar's left end, takes the double click for the bar.
    const pill = bar.locator('[data-frame-state]')
    await expect(pill).toBeInViewport({ ratio: 0.99 })

    // Dragging the bar by (40, 40) screen px at zoom 0.4 moves every member by
    // (100, 100) canvas units, in one batch; the node outside stays put.
    const rects = () => page.evaluate((nodeIds) => {
      const nodes = Object.values(window.__cateE2E!.document()!.canvases).flatMap((c) => Object.values(c.nodes))
      return nodeIds.map((id) => nodes.find((n) => n.id === id)!.rect.origin)
    }, [...members, outside].map((m) => m.nodeId))
    const before = await rects()
    const grip = (await bar.locator('[data-frame-title]').boundingBox())!
    await page.mouse.move(grip.x + 10, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + 30, grip.y + grip.height / 2 + 20, { steps: 4 })
    await page.mouse.move(grip.x + 50, grip.y + grip.height / 2 + 40, { steps: 4 })
    await page.mouse.up()
    const moved = before.map((o, i) => (i < members.length ? { x: o.x + 100, y: o.y + 100 } : o))
    await expect.poll(async () => (await rects()).map((o) => ({ x: Math.round(o.x), y: Math.round(o.y) }))).toEqual(moved.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y) })))
    await expect(pill).toBeInViewport({ ratio: 0.99 })

    await call('cate.frame.state', { frameId: frame.id, state: 'waiting' })
    await expect(pill).toHaveAttribute('data-frame-state', 'waiting')
    await expect(pill).toHaveText('waiting on you')
    const open = (await page.locator(`[data-frame="${frame.id}"]`).boundingBox())!

    const node = (id: string) => page.locator(`[data-node-id="${id}"]`)
    const surfaceShown = () => page.evaluate((id) => document.querySelector<HTMLElement>(`[data-browser-surface="${id}"]`)?.dataset.browserSurfaceVisible ?? null, browser.panelId)

    await expect.poll(surfaceShown).toBe('true')

    await pill.dblclick()
    await expect.poll(async () => (await frames())[0].collapsed).toBe(true)
    await expect.poll(async () => (await page.locator(`[data-frame="${frame.id}"]`).boundingBox())!.height).toBeLessThan(open.height / 2)
    await expect(bar.locator('[data-frame-title]')).toHaveText('#n1 e2e')
    // Editor and terminal unmount; the browser stays mounted, hidden.
    await expect(node(editor.nodeId)).toHaveCount(0)
    await expect(node(terminal.nodeId)).toHaveCount(0)
    await expect(node(browser.nodeId)).toHaveCount(1)
    await expect(node(browser.nodeId)).toHaveCSS('visibility', 'hidden')
    await expect.poll(surfaceShown).not.toBe('true')

    await pill.dblclick()
    await expect.poll(async () => (await frames())[0].collapsed).toBe(false)
    for (const member of members) await expect(node(member.nodeId)).toBeVisible()
    await expect.poll(surfaceShown).toBe('true')
    // Same guest, same page: nothing reloaded.
    expect(await waitForBrowserGuest(page, browser.panelId)).toBe(guest)
    expect(await pageMark()).toBe('kept')

    // Fold again and reload the window: state and fold come back from the document.
    await pill.dblclick()
    await expect.poll(async () => (await frames())[0].collapsed).toBe(true)
    await page.reload()
    await page.waitForFunction(() => window.__cateE2E?.ready === true, null, { timeout: 45_000 })
    await expect.poll(frames, { timeout: 20_000 }).toEqual([{ id: frame.id, title: '#n1 e2e', collapsed: true, state: 'waiting' }])
    await expect(bar.locator('[data-frame-title]')).toHaveText('#n1 e2e')
    await expect(pill).toHaveText('waiting on you')
    await expect(bar.locator('[data-frame-count]')).toHaveText('3')
    await expect(node(editor.nodeId)).toHaveCount(0)
  } finally { await closeApp(app) }
})
