// Screenshots + WCAG contrast of the frame title bar in its four states, light and
// dark theme, in Chromium (never Electron).
// Usage: node scripts/canvas-frame-profile/capture.mjs <outDir>   (dev server on :5198)
// Text must reach 4.5:1; the state icon and the count icon (non-text) 3:1.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [out = '.'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const THEMES = { clair: 'light-subtle', sombre: 'dark-warm' }
const STATES = ['active', 'waiting', 'blocked', 'done']
const BASE = 'http://127.0.0.1:5198/scripts/canvas-frame-profile/index.html'

// Runs in the page: every text element and icon of the bar with its colour, effective background and ratio.
function measure() {
	const parse = (css) => {
		const srgb = css.match(/color\(srgb ([^)]+)\)/)
		if (srgb) {
			const [r, g, b, a = 1] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number)
			return [r * 255, g * 255, b * 255, a]
		}
		const m = css.match(/rgba?\(([^)]+)\)/)
		if (!m) return [0, 0, 0, 0]
		const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
		return [r, g, b, a]
	}
	const over = (top, bottom) => {
		const a = top[3] + bottom[3] * (1 - top[3])
		return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a)
	}
	const lum = ([r, g, b]) => {
		const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
	}
	const ratio = (a, b) => {
		const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
		return (hi + 0.05) / (lo + 0.05)
	}
	const background = (el) => {
		let bg = [0, 0, 0, 0]
		for (let n = el; n; n = n.parentElement) bg = over(bg, parse(getComputedStyle(n).backgroundColor))
		return over(bg, parse(getComputedStyle(document.body).backgroundColor))
	}
	const rows = []
	const bar = document.querySelector('[data-frame-bar]')
	for (const el of bar.querySelectorAll('*')) {
		const isIcon = el.tagName.toLowerCase() === 'svg'
		const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
		if (!isIcon && !own) continue
		const bg = background(el)
		const fg = over(parse(getComputedStyle(el).color), bg)
		rows.push({
			label: isIcon ? `icône ${el.closest('[data-frame-state]') ? 'état' : 'compte'}` : `${el.tagName.toLowerCase()} « ${el.textContent.trim().slice(0, 24)} »`,
			min: isIcon ? 3 : 4.5,
			ratio: Math.round(ratio(fg, bg) * 100) / 100
		})
	}
	return rows
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
let fails = 0
for (const [themeName, themeId] of Object.entries(THEMES)) {
	for (const state of STATES) {
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
		await page.goto(`${BASE}?scene=frame&theme=${themeId}&state=${state}`)
		await page.waitForSelector('[data-frame-bar]')
		await page.waitForTimeout(400)
		const rows = await page.evaluate(measure)
		const bar = page.locator('[data-frame-bar]')
		const box = await bar.boundingBox()
		await page.screenshot({ path: `${out}/barre-${themeName}-${state}.png`, clip: { x: box.x - 12, y: box.y - 12, width: Math.min(box.width + 24, 1200), height: box.height + 24 } })
		await page.screenshot({ path: `${out}/canvas-${themeName}-${state}.png` })
		console.log(`\n## ${themeName} / ${state}`)
		for (const r of rows) {
			const bad = r.ratio < r.min
			if (bad) fails++
			console.log(`${bad ? 'FAIL' : 'ok  '} ${String(r.ratio).padStart(5)} (min ${r.min})  ${r.label}`)
		}
		await page.close()
	}
}
await browser.close()
console.log(`\n${fails === 0 ? 'Tous les contrastes passent' : `${fails} contraste(s) sous le seuil`}`)
process.exitCode = fails === 0 ? 0 : 1
