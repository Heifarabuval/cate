import { test, expect } from '@playwright/test'
import { launchApp, closeApp, addCanvas, seedOnCanvas } from './fixtures/electron-app'

// The whole journey of issue #9: `cate panel group create` and `add` (the
// `cate.frame.*` methods the CLI calls, reached through the `api` capability
// since the dev bundle ships no `cate` binary), then the frame folded into its
// bar, all read from the document and from the frame drawn on the canvas.
test('a frame created through the cate API takes a panel and folds into its bar', async () => {
  const { electronApp: app, mainWindow: page } = await launchApp()
  try {
    const canvas = await addCanvas(page)
    const editor = await seedOnCanvas(page, 'editor', { x: 900, y: 60 })
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
    await expect(bar.locator('[data-frame-state]')).toHaveAttribute('data-frame-state', frame.state)

    await call('cate.frame.add', { frameId: frame.id, panelId: editor.panelId })
    await expect.poll(() => page.evaluate((nodeId) => {
      const nodes = Object.values(window.__cateE2E!.document()!.canvases).flatMap((c) => Object.values(c.nodes))
      return nodes.find((n) => n.id === nodeId)?.frameId ?? null
    }, editor.nodeId)).toBe(frame.id)
    await expect(bar.locator('[data-frame-count]')).toHaveText('1')
    const open = (await page.locator(`[data-frame="${frame.id}"]`).boundingBox())!

    await bar.dblclick()
    await expect.poll(async () => (await frames())[0].collapsed).toBe(true)
    await expect.poll(async () => (await page.locator(`[data-frame="${frame.id}"]`).boundingBox())!.height).toBeLessThan(open.height / 2)
    await expect(bar.locator('[data-frame-title]')).toHaveText('#n1 e2e')
  } finally { await closeApp(app) }
})
