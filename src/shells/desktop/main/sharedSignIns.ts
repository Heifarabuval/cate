// Shared sign-ins: cookies of the domains in `browserSharedSignInDomains`
// (google.com, github.com, ...) are the same in every workspace partition.
// A hub partition keeps them while no workspace is open; a change in one
// partition is written to the hub and to every other attached partition.
// An import from the default browser is a one-off seed of every cookie but
// the excluded domains': it is not synced afterwards.

import type { Cookie, CookiesSetDetails } from 'electron'
import { createLogger } from '@kernel/log/contract'

const log = createLogger('web')

/** The part of `Session.cookies` the sync uses. */
export interface CookieJar {
  get(filter: Electron.CookiesGetFilter): Promise<Cookie[]>
  set(details: CookiesSetDetails): Promise<void>
  remove(url: string, name: string): Promise<void>
  on(event: 'changed', listener: (event: unknown, cookie: Cookie, cause: string, removed: boolean) => void): unknown
}

export interface SharedSignIns {
  /** Copies the shared cookies into `jar` and keeps it in sync; idempotent. */
  attach(jar: CookieJar): Promise<void>
  /** Writes `cookies` but those of `excluded` domains (and their subdomains)
   *  to the hub and every attached jar; the count written. A jar attached
   *  later receives the ones it does not hold. */
  importCookies(cookies: Cookie[], excluded: readonly string[]): Promise<number>
  /** One-off copy of the hub's cookies of `domain` into `jar` (an agent's
   *  partition): no sync in either direction; the count copied. A domain
   *  outside the shared list copies nothing. */
  grant(jar: CookieJar, domain: string): Promise<number>
}

/** True when `domain` (a cookie domain, maybe with a leading dot) is one of
 *  `shared` or a subdomain of one. */
export function isSharedDomain(domain: string | undefined, shared: readonly string[]): boolean {
  const host = (domain ?? '').replace(/^\./, '').toLowerCase()
  return host !== '' && shared.some((d) => host === d || host.endsWith(`.${d}`))
}

const cookieUrl = (c: Cookie) => `${c.secure ? 'https' : 'http'}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`
const idOf = (c: Cookie) => `${c.name}|${c.domain ?? ''}|${c.path ?? '/'}`

export function toSetDetails(c: Cookie): CookiesSetDetails {
  return {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path ?? '/',
    // A host-only cookie (and every `__Host-` one) must not name a domain.
    ...(c.hostOnly ? {} : { domain: c.domain }),
    secure: c.secure,
    httpOnly: c.httpOnly,
    ...(c.session || c.expirationDate === undefined ? {} : { expirationDate: c.expirationDate }),
    sameSite: c.sameSite,
  }
}

// Our own writes come back as `changed` events; they are dropped for a while.
const ECHO_MS = 5_000

export function createSharedSignIns(deps: { hub: CookieJar; domains(): readonly string[]; now?: () => number }): SharedSignIns {
  const now = deps.now ?? Date.now
  const attached = new Map<CookieJar, Promise<void>>()
  const echoes = new Map<CookieJar, Map<string, number>>()
  const echoKey = (c: Cookie, removed: boolean) => `${idOf(c)}|${removed ? '-' : `+${c.value}`}`

  const write = async (jar: CookieJar, cookie: Cookie, removed: boolean) => {
    const pending = echoes.get(jar)
    const key = echoKey(cookie, removed)
    pending?.set(key, now())
    try {
      if (removed) await jar.remove(cookieUrl(cookie), cookie.name)
      else await jar.set(toSetDetails(cookie))
    } catch (error) {
      pending?.delete(key)
      log.warn('shared sign-in cookie %s on %s not copied: %s', cookie.name, cookie.domain, error)
    }
  }

  const spread = (from: CookieJar | null, cookie: Cookie, removed: boolean) =>
    Promise.all([deps.hub, ...attached.keys()].filter((jar) => jar !== from).map((jar) => write(jar, cookie, removed)))

  const isEcho = (jar: CookieJar, key: string) => {
    const pending = echoes.get(jar)!
    const at = pending.get(key)
    if (at === undefined) return false
    pending.delete(key)
    return now() - at < ECHO_MS
  }

  const shared = (c: Cookie) => isSharedDomain(c.domain, deps.domains())

  return {
    attach(jar) {
      let ready = attached.get(jar)
      if (ready) return ready
      echoes.set(jar, new Map())
      jar.on('changed', (_event, cookie, cause, removed) => {
        if (!shared(cookie) || isEcho(jar, echoKey(cookie, removed))) return
        // Overwrites, expiry and eviction happen in every jar on their own.
        if (removed && cause !== 'explicit') return
        void spread(jar, cookie, removed)
      })
      ready = (async () => {
        const [hub, own] = await Promise.all([deps.hub.get({}), jar.get({})])
        const hubIds = new Set(hub.filter(shared).map(idOf))
        const ownValues = new Map(own.map((c) => [idOf(c), c.value]))
        // Hub cookies of shared domains win; imported ones only fill gaps, so
        // a stale import never overwrites a newer sign-in. This jar's other
        // shared cookies (signed in before the setting existed) join the hub
        // and the other jars.
        await Promise.all([
          ...hub.filter((c) => (shared(c) ? ownValues.get(idOf(c)) !== c.value : !ownValues.has(idOf(c)))).map((c) => write(jar, c, false)),
          ...own.filter((c) => shared(c) && !hubIds.has(idOf(c))).map((c) => spread(jar, c, false)),
        ])
      })()
      attached.set(jar, ready)
      return ready
    },
    async grant(jar, domain) {
      if (!isSharedDomain(domain, deps.domains())) return 0
      const granted = (await deps.hub.get({})).filter((c) => isSharedDomain(c.domain, [domain.replace(/^\./, '').toLowerCase()]))
      await Promise.all(granted.map((c) => write(jar, c, false)))
      return granted.length
    },
    async importCookies(cookies, excluded) {
      const kept = cookies.filter((c) => !isSharedDomain(c.domain, excluded))
      await Promise.all(kept.map((c) => spread(null, c, false)))
      return kept.length
    },
  }
}
