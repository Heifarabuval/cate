// Web security hardening for every webContents: app windows may only show the
// app, guests (browser panels) get the restricted guest preload, a
// sandbox, a workspace partition with its network policy prepared, and no
// popups (a popup becomes a tab of the owning browser panel).

import { app, session as electronSession, type Session, type WebContents } from 'electron'
import { createLogger } from '@kernel/log/contract'
import { shortcutMatches, type ActionId } from '@kernel/interaction/contract'
import type { BrowserShortcutAction } from '@services/browser/contract'
import { isAgentKeyInput, sendBrowserShortcut, sendOpenTabRequest } from '@services/browser/desktop'
import { DESKTOP_CHANNELS as C, type MenuModel } from '../contract'

const log = createLogger('security')

/** A kind of guest other than the browser's (spec 008): its own preload and
 *  a locked session, declared by the module that mounts it. The partition
 *  names the kind; `browser: false` means no popup-to-tab, no permission
 *  grant, no browser user agent and no browser shortcut for its pages. */
export interface GuestKind {
  id: string
  matches(partition: string): boolean
  preload: string
  browser: false
}

interface WebSecurityOptions {
  /** The browser guest's preload, for every partition no `guestKinds` entry claims. */
  guestPreload: string
  guestKinds?: readonly GuestKind[]
  /** The dev server origin, when running under electron-vite dev. */
  rendererUrl?: string
  hardeningDisabled(): boolean
  /** The keys a web page never gets, from the menu model. */
  guestKeys(): MenuModel['guestKeys']
  /** True once the workspace partition's network policy is in place. */
  isPreparedPartition(partition: string): boolean
  platform?: NodeJS.Platform
}

export function isAllowedGuestUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'data:'
  } catch {
    return false
  }
}

export function isTrustedAppUrl(url: string, rendererUrl?: string): boolean {
  if (url.startsWith('file://')) return true
  if (!rendererUrl) return false
  try { return new URL(url).origin === new URL(rendererUrl).origin } catch { return false }
}

/** A guest key that drives the browser panel rather than the page. */
export function browserActionForInput(input: Pick<Electron.Input, 'type' | 'meta' | 'control' | 'shift' | 'code'>, platform: NodeJS.Platform): BrowserShortcutAction | null {
  if (input.type !== 'keyDown') return null
  if (!(platform === 'darwin' ? input.meta : input.control)) return null
  switch (input.code) {
    case 'KeyR': return input.shift ? 'reloadHard' : 'reload'
    case 'KeyL': return input.shift ? null : 'focusUrl'
    case 'BracketLeft': return input.shift ? null : 'back'
    case 'BracketRight': return input.shift ? null : 'forward'
    default: return null
  }
}

/** A key pressed inside a guest that the window runs instead (an action
 *  declared `fromGuests`); it never bubbles to the host otherwise. */
export function forwardedActionForInput(input: Pick<Electron.Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>, guestKeys: MenuModel['guestKeys'], platform: NodeJS.Platform): ActionId | null {
  if (input.type !== 'keyDown') return null
  const event = {
    key: input.key,
    // Stored shortcuts say "command" for the platform's primary modifier.
    metaKey: platform === 'darwin' ? input.meta : input.control,
    ctrlKey: platform === 'darwin' ? input.control : false,
    altKey: input.alt,
    shiftKey: input.shift,
  }
  return guestKeys.find(({ shortcut }) => shortcutMatches(event, shortcut))?.action ?? null
}

const guestSessions = new WeakSet<Session>()

/** The page a locked session shows: the one origin that serves it (the last
 *  `src`, a replaced one is gone) and the hosts its policy lets it call. */
export interface PanelPage {
  origin: string | null
  hosts: readonly string[]
}

/** The WebRTC policy of a locked session: no UDP outside a proxy, so no STUN. */
export const LOCKED_WEBRTC_POLICY = 'disable_non_proxied_udp'

/** A locked session's page per session. A page never leaves its origin, by
 *  link, script, redirect or window, whatever its content policy says. */
const lockedSessions = new WeakMap<Session, PanelPage>()

const originOf = (url: string): string | null => {
  try { return new URL(url).origin } catch { return null }
}

/** The hosts of `connect-src` in a page policy, `'self'` left out. */
export function declaredHosts(csp: string | undefined): string[] {
  const directive = csp?.split(';').map((part) => part.trim().split(/\s+/)).find(([name]) => name === 'connect-src')
  return directive ? directive.slice(1).filter((source) => !source.startsWith("'")) : []
}

/** `*.host` covers subdomains only; no port means the scheme's default, as in a CSP. */
const matchesHost = (url: URL, source: string): boolean => {
  const [host, port] = source.toLowerCase().split(':')
  if (port ? (url.port || (/^(https|wss):$/.test(url.protocol) ? '443' : '80')) !== port : url.port !== '') return false
  return host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host
}

/** Whether a request of a custom panel page may leave (FR-004, Q12): the main
 *  frame only to the page's origin; a resource to it or a declared host;
 *  `data:` and `blob:` stay with the page policy. */
export function isPanelRequestAllowed(request: { resourceType: string; url: string }, page: PanelPage): boolean {
  let url: URL
  try { url = new URL(request.url) } catch { return false }
  if (page.origin !== null && url.origin === page.origin) return true
  if (request.resourceType === 'mainFrame' || page.origin === null) return false
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true
  return /^(https?|wss?):$/.test(url.protocol) && page.hosts.some((source) => matchesHost(url, source))
}

const staysOnOrigin = (contents: WebContents, url: string): boolean => {
  const page = lockedSessions.get(contents.session)
  return !page || isPanelRequestAllowed({ resourceType: 'mainFrame', url }, page)
}

function browserUserAgent(target: Session): string {
  const product = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return target.getUserAgent().replace(/\sElectron\/\S+/g, '').replace(new RegExp(`\\s${product}/\\S+`, 'g'), '')
}

function configureGuestSession(target: Session, platform: NodeJS.Platform): void {
  if (guestSessions.has(target)) return
  guestSessions.add(target)
  const userAgent = browserUserAgent(target)
  target.setUserAgent(userAgent, app.getLocale())
  const chromeMajor = /\b(?:Chrome|Chromium)\/(\d+)\./.exec(userAgent)?.[1]
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    const name = (wanted: string) => Object.keys(headers).find((key) => key.toLowerCase() === wanted) ?? wanted
    headers[name('user-agent')] = userAgent
    if (chromeMajor) {
      headers[name('sec-ch-ua')] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not=A?Brand";v="24"`
      headers[name('sec-ch-ua-mobile')] = '?0'
      headers[name('sec-ch-ua-platform')] = platform === 'darwin' ? '"macOS"' : platform === 'win32' ? '"Windows"' : '"Linux"'
    }
    callback({ requestHeaders: headers })
  })
  const allowed = new Set(['cookies', 'storage-access'])
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    if (!allowed.has(permission)) log.warn('denied guest permission %s', permission)
    callback(allowed.has(permission))
  })
  target.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))
  target.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame' && !isAllowedGuestUrl(details.url)) {
      log.warn('blocked guest navigation to %s', details.url)
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

/** The session of a custom panel: no permission, and requests only to the
 *  origin that serves its page (`src`, the last one: a replaced origin is
 *  gone, FR-005) or, for resources, to the hosts its policy declares. */
function lockGuestSession(target: Session, src: string): void {
  const known = lockedSessions.has(target)
  lockedSessions.set(target, { origin: originOf(src), hosts: [] })
  if (known) return
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    log.warn('denied custom panel permission %s', permission)
    callback(false)
  })
  target.setPermissionCheckHandler(() => false)
  target.webRequest.onBeforeRequest((details, callback) => {
    const page = lockedSessions.get(target)!
    const allowed = isPanelRequestAllowed(details, page)
    if (!allowed) log.warn('blocked custom panel request to %s', details.url)
    callback({ cancel: !allowed })
  })
  // The page server's policy names the declared hosts: read them from its main frame.
  target.webRequest.onHeadersReceived((details, callback) => {
    const page = lockedSessions.get(target)!
    if (details.resourceType === 'mainFrame' && page.origin !== null && originOf(details.url) === page.origin) {
      const header = Object.entries(details.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === 'content-security-policy')?.[1]
      lockedSessions.set(target, { ...page, hosts: declaredHosts(header?.join(';')) })
    }
    callback({})
  })
}

function hardenGuest(contents: WebContents, options: WebSecurityOptions, platform: NodeJS.Platform): void {
  const stayOnTheWeb = (event: Electron.Event, url: string) => {
    if (!isAllowedGuestUrl(url) || !staysOnOrigin(contents, url)) {
      log.warn('blocked guest navigation to %s', url)
      event.preventDefault()
    }
  }
  contents.on('will-navigate', stayOnTheWeb)
  contents.on('will-redirect', stayOnTheWeb)
  // `will-attach-webview` locked the session before this guest was created.
  if (lockedSessions.has(contents.session)) contents.setWebRTCIPHandlingPolicy(LOCKED_WEBRTC_POLICY)
  contents.setWindowOpenHandler(({ url }) => {
    if (guestSessions.has(contents.session) && isAllowedGuestUrl(url)) sendOpenTabRequest(contents, url)
    else log.warn('blocked popup to %s', url)
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, input) => {
    const host = contents.hostWebContents
    if (!host || isAgentKeyInput(contents)) return
    const forwarded = forwardedActionForInput(input, options.guestKeys(), platform)
    if (forwarded) {
      event.preventDefault()
      host.send(C.menuAction, forwarded)
      return
    }
    const action = guestSessions.has(contents.session) ? browserActionForInput(input, platform) : null
    if (!action) return
    event.preventDefault()
    sendBrowserShortcut(host, action)
  })
}

export function installWebSecurity(options: WebSecurityOptions): void {
  const platform = options.platform ?? process.platform
  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType()
    if (type === 'webview') hardenGuest(contents, options, platform)
    else contents.setWindowOpenHandler(() => ({ action: 'deny' }))

    if (type === 'window') {
      contents.on('will-navigate', (event, url) => {
        if (!isTrustedAppUrl(url, options.rendererUrl)) {
          log.warn('blocked app window navigation to %s', url)
          event.preventDefault()
        }
      })
    }

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      if (options.hardeningDisabled()) return
      const src = typeof params.src === 'string' ? params.src : 'about:blank'
      if (!isAllowedGuestUrl(src)) {
        log.warn('blocked guest attach for %s', src)
        event.preventDefault()
        return
      }
      // Loopback must mean the runtime's machine: only a workspace partition
      // with native networking or its protected proxy prepared may host a guest.
      const partition = typeof webPreferences.partition === 'string' ? webPreferences.partition : ''
      if (!options.isPreparedPartition(partition)) {
        log.warn('blocked guest attach: partition %s is not a prepared workspace partition', partition || '(default)')
        event.preventDefault()
        return
      }
      // Pin the guest preload; never trust one the renderer supplied.
      const kind = options.guestKinds?.find((candidate) => candidate.matches(partition))
      ;(webPreferences as { preload?: string }).preload = kind?.preload ?? options.guestPreload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      ;(webPreferences as { allowRunningInsecureContent?: boolean }).allowRunningInsecureContent = false
      if (kind) {
        delete params.allowpopups
        lockGuestSession(electronSession.fromPartition(partition), src)
        return
      }
      // Popups reach the window-open handler, which turns them into tabs.
      params.allowpopups = 'true'
      configureGuestSession(electronSession.fromPartition(partition), platform)
    })
  })
}

/** The app's own pages: a strict CSP on the renderer's documents. */
export function installAppCsp(rendererUrl: string | undefined): void {
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url
    if (!url.startsWith('file://') && !(rendererUrl && url.startsWith(rendererUrl))) {
      callback({})
      return
    }
    const dev = rendererUrl ? " 'unsafe-inline' 'unsafe-eval'" : ''
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'${dev}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: ws: wss: sentry-ipc:; font-src 'self' data:; frame-src https: http://localhost:* http://127.0.0.1:*; base-uri 'self'`,
        ],
      },
    })
  })
}
