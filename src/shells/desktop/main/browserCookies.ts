// Reads the cookies of the system's default browser (macOS) for "Import
// sign-ins": Chromium browsers (Keychain-encrypted SQLite), Firefox (plain
// SQLite) and Safari (Cookies.binarycookies, needs Full Disk Access). Files
// are copied first: a running browser keeps its database locked.

import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Cookie } from 'electron'

const run = promisify(execFile)

interface Chromium { kind: 'chromium'; dir: string; keychain: string }
type BrowserSource = Chromium | { kind: 'firefox' } | { kind: 'safari' }

// ponytail: Default profile only; other Chromium profiles (Profile 1, Arc spaces on another profile) are not read.
const SUPPORT = path.join(os.homedir(), 'Library/Application Support')
const BROWSERS: Record<string, BrowserSource> = {
  'Google Chrome': { kind: 'chromium', dir: 'Google/Chrome', keychain: 'Chrome Safe Storage' },
  Arc: { kind: 'chromium', dir: 'Arc/User Data', keychain: 'Arc Safe Storage' },
  'Brave Browser': { kind: 'chromium', dir: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage' },
  'Microsoft Edge': { kind: 'chromium', dir: 'Microsoft Edge', keychain: 'Microsoft Edge Safe Storage' },
  Vivaldi: { kind: 'chromium', dir: 'Vivaldi', keychain: 'Vivaldi Safe Storage' },
  Chromium: { kind: 'chromium', dir: 'Chromium', keychain: 'Chromium Safe Storage' },
  Firefox: { kind: 'firefox' },
  Safari: { kind: 'safari' },
}

const SAME_SITE: Cookie['sameSite'][] = ['no_restriction', 'lax', 'strict']
const sameSite = (value: number): Cookie['sameSite'] => SAME_SITE[value] ?? 'unspecified'

function cookie(c: { domain: string; name: string; value: string; path: string; secure: boolean; httpOnly: boolean; expires?: number; sameSite: Cookie['sameSite'] }): Cookie {
  return {
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
    hostOnly: !c.domain.startsWith('.'), secure: c.secure, httpOnly: c.httpOnly,
    session: c.expires === undefined, expirationDate: c.expires, sameSite: c.sameSite,
  }
}

const alive = (c: Cookie) => c.expirationDate === undefined || c.expirationDate * 1000 > Date.now()

async function withCopy<T>(file: string, read: (copy: string) => T): Promise<T> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cate-cookies-'))
  try {
    const copy = path.join(dir, path.basename(file))
    await fs.promises.copyFile(file, copy)
    for (const ext of ['-wal', '-shm']) await fs.promises.copyFile(file + ext, copy + ext).catch(() => {})
    return read(copy)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

async function sqlite<T>(file: string, query: string): Promise<{ rows: T[]; version: number }> {
  const { DatabaseSync } = await import('node:sqlite')
  return withCopy(file, (copy) => {
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const meta = query.includes(' cookies ') ? db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get() as { value?: string } | undefined : undefined
      return { rows: db.prepare(query).all() as T[], version: Number(meta?.value ?? 0) }
    } finally { db.close() }
  })
}

/** Decrypts a macOS Chromium cookie value (`v10`, AES-128-CBC with a key
 *  derived from the Keychain password). From database version 24 the plain
 *  text starts with the SHA-256 of the host. */
export function decryptChromium(encrypted: Uint8Array, key: Buffer, version: number): string {
  const data = Buffer.from(encrypted)
  if (data.subarray(0, 3).toString() !== 'v10') return data.toString('utf8')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  const plain = Buffer.concat([decipher.update(data.subarray(3)), decipher.final()])
  return (version >= 24 ? plain.subarray(32) : plain).toString('utf8')
}

export const chromiumKey = (password: string) => pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')

// Chromium time: microseconds since 1601-01-01.
const fromChromiumTime = (us: number) => us / 1e6 - 11_644_473_600

async function readChromium(source: Chromium): Promise<Cookie[]> {
  const { stdout } = await run('security', ['find-generic-password', '-w', '-s', source.keychain])
  const key = chromiumKey(stdout.trim())
  type Row = { host_key: string; name: string; value: string; encrypted_value: Uint8Array; path: string; expires_utc: number; has_expires: number; is_secure: number; is_httponly: number; samesite: number }
  const { rows, version } = await sqlite<Row>(
    path.join(SUPPORT, source.dir, 'Default/Cookies'),
    `SELECT host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite FROM cookies WHERE top_frame_site_key = ''`,
  )
  return rows.map((r) => cookie({
    domain: r.host_key, name: r.name, path: r.path,
    value: r.value || decryptChromium(r.encrypted_value, key, version),
    secure: !!r.is_secure, httpOnly: !!r.is_httponly, sameSite: sameSite(r.samesite),
    expires: r.has_expires ? fromChromiumTime(Number(r.expires_utc)) : undefined,
  }))
}

async function firefoxProfile(): Promise<string> {
  const root = path.join(SUPPORT, 'Firefox')
  const ini = await fs.promises.readFile(path.join(root, 'profiles.ini'), 'utf8')
  // The [Install...] section names the profile this installation opens.
  const install = /^\[Install[^\]]*\][^[]*?^Default=(.+)$/m.exec(ini)?.[1]
  const flagged = /^Path=(.+)$(?=[^[]*^Default=1$)/m.exec(ini)?.[1]
  const profile = (install ?? flagged ?? /^Path=(.+)$/m.exec(ini)?.[1])?.trim()
  if (!profile) throw new Error('No Firefox profile found')
  return path.isAbsolute(profile) ? profile : path.join(root, profile)
}

async function readFirefox(): Promise<Cookie[]> {
  type Row = { host: string; name: string; value: string; path: string; expiry: number; isSecure: number; isHttpOnly: number; sameSite: number }
  const { rows } = await sqlite<Row>(
    path.join(await firefoxProfile(), 'cookies.sqlite'),
    `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''`,
  )
  return rows.map((r) => cookie({
    domain: r.host, name: r.name, value: r.value, path: r.path,
    secure: !!r.isSecure, httpOnly: !!r.isHttpOnly, sameSite: sameSite(r.sameSite),
    // Firefox stores seconds, milliseconds since version 136.
    expires: Number(r.expiry) > 1e11 ? Number(r.expiry) / 1000 : Number(r.expiry),
  }))
}

// Mac absolute time: seconds since 2001-01-01.
const MAC_EPOCH = 978_307_200

/** Parses Safari's `Cookies.binarycookies`. */
export function parseBinaryCookies(file: Buffer): Cookie[] {
  if (file.subarray(0, 4).toString() !== 'cook') throw new Error('Not a Safari cookie file')
  const pages = file.readUInt32BE(4)
  const out: Cookie[] = []
  let page = 8 + pages * 4
  for (let p = 0; p < pages; p += 1) {
    const size = file.readUInt32BE(8 + p * 4)
    const count = file.readUInt32LE(page + 4)
    for (let i = 0; i < count; i += 1) {
      const at = page + file.readUInt32LE(page + 8 + i * 4)
      const flags = file.readUInt32LE(at + 8)
      const text = (offset: number) => {
        const start = at + file.readUInt32LE(at + offset)
        return file.toString('utf8', start, file.indexOf(0, start))
      }
      out.push(cookie({
        domain: text(16), name: text(20), path: text(24), value: text(28),
        secure: (flags & 1) !== 0, httpOnly: (flags & 4) !== 0, sameSite: 'unspecified',
        expires: file.readDoubleLE(at + 40) + MAC_EPOCH,
      }))
    }
    page += size
  }
  return out
}

async function readSafari(): Promise<Cookie[]> {
  const file = path.join(os.homedir(), 'Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies')
  try {
    return parseBinaryCookies(await fs.promises.readFile(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') throw new Error('Give Cate Full Disk Access (System Settings › Privacy & Security) to import from Safari')
    throw error
  }
}

/** The default browser's live cookies; throws a message for the person when
 *  that browser or this platform is not supported. */
export async function readDefaultBrowserCookies(browser: string): Promise<Cookie[]> {
  if (process.platform !== 'darwin') throw new Error('Importing sign-ins is only available on macOS')
  const source = BROWSERS[browser]
  if (!source) throw new Error(`Cannot import sign-ins from ${browser || 'the default browser'}`)
  const cookies = source.kind === 'chromium' ? await readChromium(source) : source.kind === 'firefox' ? await readFirefox() : await readSafari()
  return cookies.filter(alive)
}
