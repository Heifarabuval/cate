#!/usr/bin/env node
// Écrit theme.css dans le dossier d'un panneau perso depuis le thème actif de Cate.
// Usage : node sync-theme.mjs <dossier-du-panneau> [--settings <settings.json>] [--cate <checkout Cate>]
// Sans dépendance. Lecture seule sur settings.json. Mac (chemin des réglages de Cate).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const flag = (name) => {
	const i = args.indexOf(name)
	return i < 0 ? undefined : args.splice(i, 2)[1]
}
const settingsPath =
	flag('--settings') ?? join(homedir(), 'Library/Application Support/cate/settings.json')
const cateDir = resolve(flag('--cate') ?? process.env.CATE_REPO ?? process.cwd())
const outDir = resolve(args[0] ?? '.')

const THEMES = 'src/kernel/interaction/contract/themes'
const VARS = [
	'surface-0', 'surface-1', 'surface-2', 'surface-3', 'surface-4', 'surface-5', 'surface-6',
	'border-subtle', 'border-strong', 'border-focus',
	'text-primary', 'text-secondary', 'text-muted', 'text-inverse',
	'focus-blue', 'surface-hover', 'surface-hover-strong',
	'activity-green', 'activity-orange', 'git-deleted'
]

// Source d'un thème intégré : origin/main d'un checkout Cate, sinon l'API GitHub du fork.
function source(file) {
	const path = `${THEMES}/${file}.ts`
	try {
		return execFileSync('git', ['-C', cateDir, 'show', `origin/main:${path}`], { encoding: 'utf8', stdio: 'pipe' })
	} catch {
		return execFileSync(
			'gh',
			['api', `repos/Heifarabuval/cate/contents/${path}?ref=main`, '-H', 'Accept: application/vnd.github.raw'],
			{ encoding: 'utf8' }
		)
	}
}

const pairs = (text) => Object.fromEntries([...text.matchAll(/'([a-z0-9-]+)':\s*'([^']*)'/g)].map((m) => [m[1], m[2]]))
const block = (text, start, end) => {
	const i = text.indexOf(start)
	if (i < 0) throw new Error(`bloc introuvable : ${start}`)
	return text.slice(i, text.indexOf(end, i))
}
const camel = (id) => id.replace(/-(\w)/g, (_, c) => c.toUpperCase())

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
let id = settings.activeThemeId
if (id === 'system') {
	let dark = false
	try {
		dark = execFileSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], { encoding: 'utf8', stdio: 'pipe' }).trim() === 'Dark'
	} catch {
		// pas de réglage d'apparence : le Mac est en clair
	}
	id = dark ? settings.systemDarkThemeId : settings.systemLightThemeId
}

let type
let app
const custom = (settings.customThemes ?? []).find((t) => t.id === id)
if (custom) {
	type = custom.type
	app = custom.app ?? {}
} else {
	const file = camel(id) // 'one-light' -> 'oneLight'
	const text = source(file)
	type = /type:\s*'(light|dark)'/.exec(text)?.[1]
	app = pairs(block(text, 'app: {', '\n  },'))
}
const base = pairs(block(source('base'), type === 'light' ? 'export const BASE_LIGHT' : 'export const BASE_DARK', '\n}'))
const merged = { ...base, ...app }

const missing = VARS.filter((v) => !merged[v])
if (missing.length) throw new Error(`variables absentes du thème ${id} : ${missing.join(', ')}`)

const css =
	`/* Généré par sync-theme.mjs depuis le thème Cate "${id}". Ne pas éditer : relancer le script. */\n` +
	`:root {\n\tcolor-scheme: ${type};\n` +
	VARS.map((v) => `\t--${v}: ${merged[v]};`).join('\n') +
	`\n}\n`
writeFileSync(join(outDir, 'theme.css'), css)
process.stdout.write(`theme.css écrit dans ${outDir} (thème ${id}, ${type})\n`)
