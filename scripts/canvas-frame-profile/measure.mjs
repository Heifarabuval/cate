// Frame times of a drag of 8 nodes, in Chromium (never Electron).
// Usage: node scripts/canvas-frame-profile/measure.mjs <base|frame> [runs] [steps]   (dev server on :5198)
// Each step is one pointermove dispatched at the start of an animation frame; the frame
// time is the gap between two frames (what the person sees), `work` the time from the move to
// the main thread being free again after that frame (render + style + layout + paint
// dispatch; the compositor is not in it). Prints median and p95 of both, over all runs.
import { chromium } from 'playwright'

const [scene = 'base', runs = '5', steps = '240'] = process.argv.slice(2)
const URL = `http://127.0.0.1:5198/scripts/canvas-frame-profile/index.html?scene=${scene}`
const target = scene === 'frame' ? '[data-frame-bar]' : '[data-testid="node-n0"]'

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const frameTimes = []
const works = []
for (let run = 0; run < Number(runs); run++) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
	page.on('pageerror', (e) => console.error('pageerror', e.message))
	await page.goto(URL)
	await page.waitForSelector(target)
	await page.waitForTimeout(500)
	const result = await page.evaluate(
		async ({ target, steps }) => {
			const el = document.querySelector(target)
			const box = el.getBoundingClientRect()
			const x0 = box.left + 40
			const y0 = box.top + 8
			const fire = (type, target, x, y) =>
				target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }))
			const frame = () => new Promise((r) => requestAnimationFrame(r))
			await frame()
			const startLeft = document.querySelector('[data-testid="node-n7"]').getBoundingClientRect().left
			fire('pointerdown', el, x0, y0)
			const frames = []
			const work = []
			let last = await frame()
			for (let i = 1; i <= steps; i++) {
				const t0 = performance.now()
				fire('pointermove', window, x0 + i * 2, y0 + i)
				const now = await frame()
				// The main thread is free again once a task queued after the frame runs.
				await new Promise((r) => {
					const c = new MessageChannel()
					c.port1.onmessage = r
					c.port2.postMessage(0)
				})
				work.push(performance.now() - Math.max(now, t0))
				frames.push(now - last)
				last = now
			}
			const moved = document.querySelector('[data-testid="node-n7"]').getBoundingClientRect().left - startLeft
			fire('pointerup', window, x0 + steps * 2, y0 + steps)
			return { frames, work, moved }
		},
		{ target, steps: Number(steps) }
	)
	frameTimes.push(...result.frames.slice(10))
	works.push(...result.work.slice(10))
	if (run === 0) console.error(`node n7 moved ${result.moved}px on screen during run 0 (expect ~${Number(steps) * 2})`)
	await page.close()
}
await browser.close()
const q = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]
const f = (n) => n.toFixed(2)
console.log(
	JSON.stringify({
		scene,
		samples: frameTimes.length,
		frameMs: { median: +f(q(frameTimes, 0.5)), p95: +f(q(frameTimes, 0.95)) },
		workMs: { median: +f(q(works, 0.5)), p95: +f(q(works, 0.95)) }
	})
)
