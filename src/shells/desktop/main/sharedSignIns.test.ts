import { createCipheriv, createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Cookie, CookiesSetDetails } from 'electron'
import { createSharedSignIns, isSharedDomain, type CookieJar } from './sharedSignIns'
import { chromiumKey, decryptChromium, parseBinaryCookies } from './browserCookies'

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
    expect(await sync.importCookies([sid('imported'), { ...sid('y'), domain: '.example.com' }])).toBe(1)
    late.userSets({ ...sid('gh'), name: 'user_session', domain: 'github.com', hostOnly: true })
    await sync.attach(late)
    await flush()
    expect(late.cookies.get('SID|.google.com|/')?.value).toBe('imported')
    expect(a.cookies.get('user_session|github.com|/')?.value).toBe('gh')
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
