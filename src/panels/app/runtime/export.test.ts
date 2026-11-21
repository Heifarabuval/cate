import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { folderFingerprint } from '../contract'
import { soundFiles, type FixtureFile } from '../test/fixtures/hostile'
import { exportPanel } from './export'

let root: string
let panneaux: string

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

/** Every file under `dir` with its sha256, links as `-> target`. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, item.name)
      const key = path.relative(dir, full)
      if (item.isSymbolicLink()) out[key] = `-> ${fs.readlinkSync(full)}`
      else if (item.isDirectory()) walk(full)
      else out[key] = sha(fs.readFileSync(full))
    }
  }
  walk(dir)
  return out
}

function writePanel(id: string, files: FixtureFile[]): string {
  const folder = path.join(panneaux, id)
  for (const file of files) {
    const target = path.join(folder, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (file.link !== undefined) fs.symlinkSync(file.link, target)
    else fs.writeFileSync(target, file.data)
  }
  return folder
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-export-'))
  // The tests never see the real `~/.cate` or `~/.claude`.
  for (const real of ['.cate', '.claude']) expect(root.startsWith(path.join(os.homedir(), real))).toBe(false)
  panneaux = path.join(root, 'panneaux')
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

it('writes a reproducible bundle whose fingerprint is the folder fingerprint, and leaves the folder alone', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  fs.mkdirSync(path.join(folder, '.git'))
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main')
  fs.mkdirSync(path.join(folder, 'node_modules', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'node_modules', 'lib', 'index.js'), 'x')
  const before = tree(folder)

  const first = await exportPanel({ folder, panneauxDir: panneaux, out: path.join(root, 'a.cate-panneau') })
  const second = await exportPanel({ folder, panneauxDir: panneaux, out: path.join(root, 'b.cate-panneau') })

  expect(first).toMatchObject({ ok: true, omitted: ['.git/', 'node_modules/'] })
  expect(fs.readFileSync(path.join(root, 'a.cate-panneau'))).toEqual(fs.readFileSync(path.join(root, 'b.cate-panneau')))
  const files = soundFiles('fusion').map((file) => ({ path: file.path, sha256: sha(file.data) }))
  expect(first.ok && first.fingerprint).toBe(folderFingerprint(files, sha))
  expect(second.ok && second.fingerprint).toBe(first.ok && first.fingerprint)
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'a.cate-panneau'), 'utf-8'))
  expect(bundle.files.map((file: { path: string }) => file.path)).toEqual(['cate-panel.json', 'index.html', 'js/app.js'])
  expect(tree(folder)).toEqual(before)
})

it('refuses a symbolic link without writing anything', async () => {
  const folder = writePanel('fusion', [...soundFiles('fusion'), { path: 'lien.js', data: '', link: 'index.html' }])
  const out = path.join(root, 'out.cate-panneau')
  const result = await exportPanel({ folder, panneauxDir: panneaux, out })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/lien\.js.*lien symbolique/) })
  expect(fs.existsSync(out)).toBe(false)
})

it('refuses a secret, naming file and line but never the value', async () => {
  const value = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const folder = writePanel('fusion', [...soundFiles('fusion'), { path: 'conf.js', data: `const a = 1\nconst t = "${value}"` }, { path: '.env', data: 'A=1' }])
  const out = path.join(root, 'out.cate-panneau')
  const result = await exportPanel({ folder, panneauxDir: panneaux, out })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toMatch(/conf\.js:2/)
  expect(result.error).toMatch(/\.env/)
  expect(JSON.stringify(result)).not.toContain(value)
  expect(fs.existsSync(out)).toBe(false)
})

it('never writes inside the panel folder', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  const before = tree(folder)
  const result = await exportPanel({ folder, panneauxDir: panneaux, out: path.join(folder, 'fusion.cate-panneau') })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/dans le dossier du panneau/) })
  expect(tree(folder)).toEqual(before)
})

it('says when the panel is missing', async () => {
  const result = await exportPanel({ folder: path.join(panneaux, 'absent'), panneauxDir: panneaux, out: path.join(root, 'x.cate-panneau') })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/absent/) })
})

it('refuses a target that already exists and leaves it untouched', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  const out = path.join(root, 'existant.txt')
  fs.writeFileSync(out, 'à garder')
  const result = await exportPanel({ folder, panneauxDir: panneaux, out })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/existe déjà/) })
  expect(fs.readFileSync(out, 'utf-8')).toBe('à garder')
})

it('refuses a symbolic link as target without writing through it', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  const victim = path.join(root, 'victime.txt')
  fs.writeFileSync(victim, 'à garder')
  const out = path.join(root, 'lien.cate-panneau')
  fs.symlinkSync(victim, out)
  const result = await exportPanel({ folder, panneauxDir: panneaux, out })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/existe déjà/) })
  expect(fs.readFileSync(victim, 'utf-8')).toBe('à garder')
})

it('refuses any target under the panels folder, another panel’s included', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  const other = writePanel('autre', soundFiles('autre'))
  const before = tree(other)
  for (const out of [path.join(other, 'index.html.bak'), path.join(panneaux, 'nouveau.cate-panneau'), path.join(panneaux, 'nouveau', 'index.html')]) {
    const result = await exportPanel({ folder, panneauxDir: panneaux, out })
    expect(result, out).toEqual({ ok: false, error: expect.stringMatching(/dossier des panneaux/) })
    expect(fs.existsSync(out), out).toBe(false)
  }
  expect(tree(other)).toEqual(before)
})

it('refuses a target reached through a link into the panels folder', async () => {
  const folder = writePanel('fusion', soundFiles('fusion'))
  const via = path.join(root, 'via')
  fs.symlinkSync(panneaux, via)
  const result = await exportPanel({ folder, panneauxDir: panneaux, out: path.join(via, 'x.cate-panneau') })
  expect(result).toEqual({ ok: false, error: expect.stringMatching(/dossier des panneaux/) })
  expect(fs.existsSync(path.join(panneaux, 'x.cate-panneau'))).toBe(false)
})
