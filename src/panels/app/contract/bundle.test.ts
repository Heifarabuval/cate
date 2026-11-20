import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bundleText, HOSTILE, rawBundle, soundFiles } from '../test/fixtures/hostile'
import { BUNDLE_LIMITS, checkPanel, parseBundle, scanSecrets, serializeBundle, validateFolder, type BundleCodec } from './bundle'
import { folderFingerprint } from './grant'

const codec: BundleCodec = {
  hash: (text) => createHash('sha256').update(text).digest('hex'),
  sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  decode: (base64) => {
    const bytes = Buffer.from(base64, 'base64')
    return bytes.toString('base64') === base64 ? bytes : null
  },
  encode: (bytes) => Buffer.from(bytes).toString('base64')
}

const asFolder = (files: ReturnType<typeof soundFiles>) =>
  files.map((file) => ({ path: file.path, size: Buffer.byteLength(file.data), link: file.link !== undefined || undefined }))

describe('parseBundle', () => {
  it('accepts a sound bundle, whose fingerprint is the folder fingerprint', () => {
    const files = soundFiles('fusion')
    const result = parseBundle(bundleText({ id: 'fusion', files }), codec)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const folder = files.map((file) => ({ path: file.path, sha256: codec.sha256(Buffer.from(file.data)) }))
    expect(result.panel.fingerprint).toBe(folderFingerprint(folder, codec.hash))
    expect(result.panel.manifest.id).toBe('fusion')
    expect(result.panel.files.map((file) => file.path)).toEqual(['cate-panel.json', 'index.html', 'js/app.js'])
  })

  it('builds the 10 Mio + 1 fixture one byte over the total limit', () => {
    const files = HOSTILE.find((item) => item.name === '10 Mio + 1')!.files
    expect(files.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0)).toBe(10 * 1024 * 1024 + 1)
  })

  for (const fixture of HOSTILE.filter((item) => item.only !== 'folder')) {
    it(`refuses ${fixture.name} with one sentence`, () => {
      const result = parseBundle(bundleText(fixture), codec)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(fixture.error)
    })
  }

  it('refuses a file whose bytes are not its sha256', () => {
    const raw = rawBundle('fusion', soundFiles('fusion'))
    raw.files[1].data = Buffer.from('autre chose').toString('base64')
    const result = parseBundle(JSON.stringify(raw), codec)
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/« index\.html » ne correspond pas/) })
  })

  it('round-trips through serializeBundle with the same bytes', () => {
    const text = bundleText({ id: 'fusion', files: soundFiles('fusion') })
    const result = parseBundle(text, codec)
    if (!result.ok) throw new Error(result.error)
    expect(serializeBundle(result.panel, codec)).toBe(`${text}\n`)
  })
})

describe('validateFolder', () => {
  it('accepts a sound folder', () => {
    expect(validateFolder(asFolder(soundFiles()))).toBeNull()
  })

  for (const fixture of HOSTILE.filter((item) => item.only !== 'bundle' && !item.tamper)) {
    // Manifest checks need the bytes: checkPanel runs them after validateFolder.
    it(`refuses ${fixture.name} (folder)`, () => {
      const error = validateFolder(asFolder(fixture.files)) ?? (() => {
        const result = checkPanel(fixture.id, fixture.files.map((file) => ({ path: file.path, bytes: Buffer.from(file.data) })), codec)
        return result.ok ? null : result.error
      })()
      expect(error).toMatch(fixture.error)
    })
  }

  it('refuses a path that is both a file and a folder', () => {
    expect(validateFolder([...asFolder(soundFiles()), { path: 'js', size: 1 }])).toMatch(/conflit de chemins/)
  })

  it('keeps the limits of Q10', () => {
    expect(BUNDLE_LIMITS).toMatchObject({ files: 200, fileBytes: 2 * 1024 * 1024, totalBytes: 10 * 1024 * 1024, pending: 10, pendingMs: 24 * 3600 * 1000 })
  })
})

describe('scanSecrets', () => {
  // Built by concatenation: the repository's secret guard must not see a token shape.
  const values = {
    github: 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    openai: 's' + 'k-' + 'proj' + 'Zz9Yy8Xx7Ww6Vv5Uu4',
    aws: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
    key: '-----BEGIN ' + 'PRIVATE KEY-----',
    mac: '/Us' + 'ers/dev/projet/x.json',
    linux: '/ho' + 'me/dev/projet/x.json'
  }
  const files = [
    { path: '.env', text: 'TOKEN=abc' },
    { path: '.env.local', text: '' },
    { path: 'certs/server.pem', text: '' },
    { path: 'id_rsa.pub', text: '' },
    { path: 'app.js', text: `const a = 1\nconst t = "${values.github}"\nconst o = '${values.openai}'` },
    { path: 'conf.js', text: `export const k = "${values.aws}"` },
    { path: 'cle.txt', text: `${values.key}\nMIIabc` },
    { path: 'chemins.js', text: `const p = "${values.mac}"\nconst q = "${values.linux}"` },
    { path: 'sain.js', text: 'const task-runner = 1; // ask-me, /Users without a name' }
  ]
  const found = scanSecrets(files)

  it('finds each kind with its file and line', () => {
    const at = found.map((item) => `${item.path}:${item.line ?? '-'}`)
    expect(at).toEqual(['.env:-', '.env.local:-', 'certs/server.pem:-', 'id_rsa.pub:-', 'app.js:2', 'app.js:3', 'conf.js:1', 'cle.txt:1', 'chemins.js:1', 'chemins.js:2'])
    for (const item of found) expect(item.kind).toEqual(expect.any(String))
  })

  it('never returns the value', () => {
    const output = JSON.stringify(found)
    for (const value of Object.values(values)) expect(output).not.toContain(value)
    expect(output).not.toContain('TOKEN=abc')
  })
})
