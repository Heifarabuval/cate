import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '../contract'
import { contentSecurityPolicy } from './server'

const skill = path.resolve(__dirname, '../../../../skills/panneau-perso')
const read = (...parts: string[]) => fs.readFileSync(path.join(skill, ...parts), 'utf-8')
const LONG_DASH = String.fromCharCode(0x2014)

interface Eval {
  id: number
  prompt: string
  expected_output: string
  expected_manifest: { id: string; permissions: { network: string[] } }
}
const evals = () => (JSON.parse(read('evals.json')) as { evals: Eval[] }).evals

describe('skill panneau-perso, jalon 1', () => {
  it('the template manifest is valid, with no warning', () => {
    const result = parseManifest(JSON.parse(read('gabarit', 'cate-panel.json')), 'mon-panneau')
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
  })

  it('the manifest an eval expects passes the parser, with no warning', () => {
    expect(evals().length).toBeGreaterThan(0)
    for (const item of evals()) {
      const result = parseManifest(item.expected_manifest, item.expected_manifest.id)
      if (!result.ok) throw new Error(`eval ${item.id}: ${result.error}`)
      expect(result.warnings, `eval ${item.id}`).toEqual([])
    }
  })

  it('the Excel preview eval needs no network, so its policy allows only the panel itself', () => {
    const excel = evals().find((item) => /excel/i.test(item.prompt))
    expect(excel?.expected_manifest.permissions.network).toEqual([])
    expect(contentSecurityPolicy(excel!.expected_manifest.permissions.network)).toContain("connect-src 'self';")
  })

  it('the template page runs under the policy: its script is a file, no inline handler, no remote resource', () => {
    const live = read('gabarit', 'index.html').replace(/<!--[\s\S]*?-->/g, '')
    for (const [, attributes, body] of live.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(attributes).toMatch(/\bsrc=/)
      expect(body.trim()).toBe('')
    }
    expect(live).not.toMatch(/\son[a-z]+\s*=/i)
    expect(live).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
    expect(live).toContain('src="app.js"')
    expect(fs.existsSync(path.join(skill, 'gabarit', 'app.js'))).toBe(true)
  })

  it('the skill text points to the new folder and no longer to the page mode', () => {
    const text = read('SKILL.md')
    expect(text).toContain('~/.cate/panneaux/')
    expect(text).not.toMatch(/panneau navigateur|file:\/\/\//)
    expect(text).not.toContain(LONG_DASH)
  })
})
