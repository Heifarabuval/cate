import { createCipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Cookie, CookiesSetDetails } from 'electron'
import { createSharedSignIns, isSharedDomain, type CookieJar } from './sharedSignIns'
import { chromiumCookiesFrom, chromiumKey, decryptChromium, parseBinaryCookies } from './browserCookies'

// A jar that, like Chromium, reports its own writes as `changed` events.
function jar() {
  const cookies = new Map<string, Cookie>()
  const listeners: ((e: unknown, c: Cookie, cause: string, removed: boolean) => void)[] = []
  const emit = (c: Cookie, cause: string, removed: boolean) => listeners.forEach((l) => l({}, c, cause, removed))
  const id = (c: { name: string; domain?: string; path?: string }) => `${c.name}|${c.domain}|${c.path ?? '/'}`
  const self: CookieJar & { cookies: Map<string, Cookie>; userSets(c: Cookie): void; userRemoves(c: Cookie): void } = {
    cookies,
    async get() { return [...cookies.values()] },
    async set(d: CookiesSetDetails) {
      const domain = d.domain ?? new URL(d.url).hostname
      const c: Cookie = { name: d.name!, value: d.value!, domain, path: d.path, hostOnly: !d.domain, secure: d.secure, httpOnly: d.httpOnly, session: !d.expirationDate, sameSite: d.sameSite ?? 'unspecified' }
      cookies.set(id(c), c)
      await Promise.resolve()
      emit(c, 'explicit', false)
    },
    async remove(url, name) {
      for (const [k, c] of cookies) if (c.name === name && url.includes(c.domain!.replace(/^\./, ''))) { cookies.delete(k); emit(c, 'explicit', true) }
    },
    on(_event, listener) { listeners.push(listener) },
    userSets(c) { cookies.set(id(c), c); emit(c, 'explicit', false) },
    userRemoves(c) { cookies.delete(id(c)); emit(c, 'explicit', true) },
  }
  return self
}

const sid = (value: string, domain = '.google.com'): Cookie => ({ name: 'SID', value, domain, path: '/', hostOnly: false, secure: true, httpOnly: true, session: false, expirationDate: 2e9, sameSite: 'lax' })
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('shared sign-ins', () => {
  it('matches a shared domain and its subdomains only', () => {
    expect(isSharedDomain('.accounts.google.com', ['google.com'])).toBe(true)
    expect(isSharedDomain('google.com', ['google.com'])).toBe(true)
    expect(isSharedDomain('evilgoogle.com', ['google.com'])).toBe(false)
    expect(isSharedDomain('.example.com', ['google.com'])).toBe(false)
  })

  it('signs every workspace in and out together, without echo loops', async () => {
    const hub = jar(), a = jar(), b = jar()
    const sync = createSharedSignIns({ hub, domains: () => ['google.com'] })
    await sync.attach(a)
    await sync.attach(b)
    a.userSets(sid('one'))
    a.userSets({ ...sid('x'), name: 'other', domain: '.example.com' })
    await flush()
    expect([...b.cookies.values()].map((c) => c.value)).toEqual(['one'])
    expect(hub.cookies.size).toBe(1)
    b.userRemoves(sid('one'))
    await flush()
    expect(a.cookies.has('SID|.google.com|/')).toBe(false)
    expect(hub.cookies.size).toBe(0)
  })

  it('gives a new workspace the hub cookies and shares what it already had', async () => {
    const hub = jar(), a = jar(), late = jar()
    const sync = createSharedSignIns({ hub, domains: () => ['google.com', 'github.com'] })
    await sync.attach(a)
    expect(await sync.importCookies([sid('imported'), { ...sid('y'), domain: '.example.com' }], ['example.com'])).toBe(1)
    late.userSets({ ...sid('gh'), name: 'user_session', domain: 'github.com', hostOnly: true })
    await sync.attach(late)
    await flush()
    expect(late.cookies.get('SID|.google.com|/')?.value).toBe('imported')
    expect(a.cookies.get('user_session|github.com|/')?.value).toBe('gh')
  })
})

describe('import', () => {
  const site = (domain: string, name = 'sess'): Cookie => ({ ...sid('v', domain), name })

  it('imports every domain except the excluded ones and their subdomains', async () => {
    const hub = jar(), a = jar()
    const sync = createSharedSignIns({ hub, domains: () => ['google.com'] })
    await sync.attach(a)
    const imported = await sync.importCookies(
      [site('.google.com'), site('.example.org'), site('.bank.example.net'), site('app.bank.example.net', 'b')],
      ['bank.example.net'],
    )
    expect(imported).toBe(2)
    expect([...a.cookies.values()].map((c) => c.domain).sort()).toEqual(['.example.org', '.google.com'])
    expect([...hub.cookies.values()].map((c) => c.domain).sort()).toEqual(['.example.org', '.google.com'])
  })

  it('seeds a workspace opened later without overwriting what it already holds', async () => {
    const hub = jar(), late = jar()
    const sync = createSharedSignIns({ hub, domains: () => [] })
    await sync.importCookies([site('.example.org'), site('.example.com', 'kept')], [])
    late.userSets({ ...site('.example.com', 'kept'), value: 'newer' })
    await sync.attach(late)
    await flush()
    expect(late.cookies.get('sess|.example.org|/')?.value).toBe('v')
    expect(late.cookies.get('kept|.example.com|/')?.value).toBe('newer')
  })
})

describe('default browser cookies', () => {
  it('decrypts a macOS Chromium v10 value of database version 24', () => {
    const key = chromiumKey('peanuts')
    const host = createHash('sha256').update('.github.com').digest()
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.concat([host, Buffer.from('token-123')])), cipher.final()])
    expect(decryptChromium(encrypted, key, 24)).toBe('token-123')
  })

  it('reads a Chromium database whose expiry times exceed 2^53', async () => {
    const key = chromiumKey('peanuts')
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    const host = createHash('sha256').update('.github.com').digest()
    const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.concat([host, Buffer.from('token-123')])), cipher.final()])
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-test-'))
    const file = path.join(dir, 'Cookies')
    const db = new DatabaseSync(file)
    db.exec(`CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');
      CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, has_expires INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)`)
    // A real Arc expiry: 2026-12-22T09:23:40Z in Chromium time.
    db.prepare(`INSERT INTO cookies VALUES ('.github.com', '', 'user_session', '', ?, '/', 13442405020329902, 1, 1, 1, 1)`).run(encrypted)
    db.close()
    try {
      const [c] = await chromiumCookiesFrom(file, key)
      expect(c).toMatchObject({ domain: '.github.com', name: 'user_session', value: 'token-123', secure: true, httpOnly: true, sameSite: 'lax' })
      expect(new Date(c.expirationDate! * 1000).toISOString()).toBe('2026-12-22T09:23:40.000Z')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses a Safari binarycookies file', () => {
    const strings = ['.github.com', 'user_session', '/', 'abc']
    const head = 56
    const record = Buffer.alloc(head)
    const body = Buffer.concat(strings.map((s) => Buffer.from(`${s}\0`)))
    record.writeUInt32LE(head + body.length, 0)
    record.writeUInt32LE(5, 8) // secure + httpOnly
    let at = head
    strings.forEach((s, i) => { record.writeUInt32LE(at, 16 + i * 4); at += s.length + 1 })
    record.writeDoubleLE(1e9, 40)
    const pageHead = Buffer.alloc(16)
    pageHead.writeUInt32BE(0x100, 0); pageHead.writeUInt32LE(1, 4); pageHead.writeUInt32LE(16, 8)
    const page = Buffer.concat([pageHead, record, body])
    const header = Buffer.alloc(12)
    header.write('cook', 0); header.writeUInt32BE(1, 4); header.writeUInt32BE(page.length, 8)
    const [c] = parseBinaryCookies(Buffer.concat([header, page]))
    expect(c).toMatchObject({ domain: '.github.com', name: 'user_session', path: '/', value: 'abc', secure: true, httpOnly: true, hostOnly: false })
    expect(c.expirationDate).toBe(1e9 + 978_307_200)
  })
})

describe('sign-in grant', () => {
  it('copies only the hub cookies of the granted domain into one jar, and keeps no sync', async () => {
    const hub = jar(), agent = jar(), other = jar()
    const sync = createSharedSignIns({ hub, domains: () => ['google.com', 'github.com'] })
    await sync.importCookies([sid('g'), { ...sid('gh'), name: 'user_session', domain: 'github.com' }, { ...sid('sub'), name: 'S', domain: '.accounts.google.com' }], [])
    expect(await sync.grant(agent, 'google.com')).toBe(2)
    expect([...agent.cookies.values()].map((c) => c.domain).sort()).toEqual(['.accounts.google.com', '.google.com'])
    // A later change in the agent jar or in the hub does not travel.
    agent.userSets({ ...sid('mine'), name: 'M', domain: '.google.com' })
    await sync.attach(other)
    await flush()
    expect(other.cookies.has('M|.google.com|/')).toBe(false)
    expect(hub.cookies.has('M|.google.com|/')).toBe(false)
  })

  it('refuses a domain outside the shared list and a lookalike', async () => {
    const hub = jar(), agent = jar()
    const sync = createSharedSignIns({ hub, domains: () => ['google.com'] })
    await sync.importCookies([sid('g')], [])
    expect(await sync.grant(agent, 'example.com')).toBe(0)
    expect(await sync.grant(agent, 'evilgoogle.com')).toBe(0)
    expect(agent.cookies.size).toBe(0)
  })
})
