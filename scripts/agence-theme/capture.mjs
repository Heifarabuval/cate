// Screenshots + WCAG contrast of the agence panel, in Chromium (never Electron).
// Usage: node scripts/agence-theme/capture.mjs <prefix> <outDir>   (dev server on :5199)
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [prefix = 'avant', out = '.'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const THEMES = { clair: 'light-subtle', sombre: 'dark-warm' }
const BASE = 'http://127.0.0.1:5199/scripts/agence-theme/index.html'
const SHOTS = [
  { name: 'question-320', scene: 'question', width: 320, compact: 1 },
  { name: 'question-834', scene: 'question', width: 834 },
  { name: 'brouillon', scene: 'draft', width: 480 },
  { name: 'bloquant', scene: 'bloquant', width: 480 },
  { name: 'bannieres', scene: 'banner', width: 480 },
  { name: 'merge', scene: 'merge', width: 480, click: 'Répondre' }
]

// Runs in the page: every text element with its color, effective background and ratio.
function measure() {
	const parse = (css) => {
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
		return over(bg, [255, 255, 255, 1])
	}
	const opacity = (el) => {
		let o = 1
		for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity)
		return o
	}
	const rows = []
	const add = (el, label, css) => {
		const bg = background(el)
		const o = opacity(el)
		let fg = parse(css)
		fg = over([fg[0], fg[1], fg[2], fg[3] * o], bg)
		rows.push({ label, fg: fg.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(','), ratio: Math.round(ratio(fg, bg) * 100) / 100 })
	}
	for (const el of document.querySelectorAll('#root *')) {
		const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
		const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28)
		if (own) add(el, `${el.tagName.toLowerCase()}${el.disabled ? '[off]' : ''} « ${text} »`, getComputedStyle(el).color)
		if (el.tagName === 'TEXTAREA') add(el, 'textarea::placeholder', getComputedStyle(el, '::placeholder').color)
	}
	return rows
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const report = {}
for (const [themeName, themeId] of Object.entries(THEMES)) {
	for (const shot of SHOTS) {
		const page = await browser.newPage({ viewport: { width: shot.width, height: 900 } })
		await page.goto(`${BASE}?scene=${shot.scene}&theme=${themeId}${shot.compact ? '&compact=1' : ''}`)
		await page.waitForSelector('#root *')
		if (shot.click) await page.getByRole('button', { name: shot.click, exact: true }).first().click()
		await page.waitForTimeout(300)
		// Answer button enabled too: a second pass with text typed in the free answer.
		report[`${themeName}/${shot.name}`] = await page.evaluate(measure)
		if (shot.scene === 'question') {
			await page.screenshot({ path: `${out}/${prefix}-${themeName}-${shot.name}-repos.png`, fullPage: true })
			await page.locator('textarea').fill('Une réponse libre')
			report[`${themeName}/${shot.name}+texte`] = await page.evaluate(measure)
		}
		await page.screenshot({ path: `${out}/${prefix}-${themeName}-${shot.name}.png`, fullPage: true })
		await page.close()
	}
}
await browser.close()
for (const [key, rows] of Object.entries(report)) {
	console.log(`\n## ${key}`)
	for (const r of rows) console.log(`${r.ratio < 4.5 ? 'FAIL' : 'ok  '} ${String(r.ratio).padStart(5)}  fg ${r.fg}  bg ${r.bg}  ${r.label}`)
}
