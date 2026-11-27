import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events')
  const app = Object.assign(new Emitter(), { getName: () => 'Cate', getLocale: () => 'en' })
  const guestSession = {
    getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/41.0.0 Cate/2.0.0',
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn(), onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
  }
  const appSession = {
    getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/41.0.0 Cate/2.0.0',
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn(), onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
  }
  // A session of its own for the partitions named `-fresh<n>`: a locked session registers its handlers once.
  const fresh = new Map<string, typeof appSession>()
  const freshSession = (partition: string) => {
    if (!fresh.has(partition)) {
      fresh.set(partition, { ...appSession, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), webRequest: { onBeforeSendHeaders: vi.fn(), onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() } })
    }
    return fresh.get(partition)!
  }
  return { app, guestSession, appSession, fresh, fromPartition: vi.fn((partition: string) => (partition.includes('-fresh') ? freshSession(partition) : partition.startsWith('app-') ? appSession : guestSession)) }
})
vi.mock('electron', () => ({ app: h.app, session: { fromPartition: h.fromPartition, defaultSession: h.appSession } }))
vi.mock('@services/browser/desktop', () => ({ isAgentKeyInput: () => false, sendBrowserShortcut: vi.fn(), sendOpenTabRequest: vi.fn() }))

import { browserActionForInput, declaredHosts, forwardedActionForInput, installAppCsp, installWebSecurity, isAllowedGuestUrl, isPanelRequestAllowed, isTrustedAppUrl, LOCKED_WEBRTC_POLICY, type PanelPage } from './webSecurity'

describe('isPanelRequestAllowed (FR-004, FR-005)', () => {
  const page: PanelPage = { origin: 'http://127.0.0.1:4000', hosts: ['api.exemple.fr', '*.cdn.fr', 'files.exemple.fr:8443'] }
  const allowed = (resourceType: string, url: string, on = page) => isPanelRequestAllowed({ resourceType, url }, on)

  it('keeps the main frame on the origin of the page', () => {
    expect(allowed('mainFrame', 'http://127.0.0.1:4000/t/notes/b.html')).toBe(true)
    for (const url of ['http://127.0.0.1:4001/x', 'https://api.exemple.fr/', 'data:text/html,hi', 'about:blank', 'not a url']) expect(allowed('mainFrame', url), url).toBe(false)
  })

  it('lets a resource reach its own origin and the declared hosts only', () => {
    expect(allowed('script', 'http://127.0.0.1:4000/t/notes/app.js')).toBe(true)
    expect(allowed('xhr', 'https://api.exemple.fr/data')).toBe(true)
    expect(allowed('webSocket', 'wss://api.exemple.fr/live')).toBe(true)
    expect(allowed('image', 'https://a.cdn.fr/x.png')).toBe(true)
    expect(allowed('xhr', 'https://files.exemple.fr:8443/f')).toBe(true)
    for (const url of ['https://evil.example/?d=secret', 'https://cdn.fr/x', 'https://api.exemple.fr:8080/', 'https://files.exemple.fr/f', 'http://127.0.0.1:4001/x', 'ftp://api.exemple.fr/']) {
      expect(allowed('other', url), url).toBe(false)
    }
  })

  it('leaves data and blob resources to the policy of the page', () => {
    expect(allowed('image', 'data:image/png;base64,AA==')).toBe(true)
    expect(allowed('media', 'blob:http://127.0.0.1:4000/1')).toBe(true)
  })

  it('refuses every resource of a page with no origin yet', () => {
    expect(allowed('xhr', 'https://api.exemple.fr/data', { origin: null, hosts: page.hosts })).toBe(false)
  })

  it('reads the declared hosts from the connect-src of the page policy', () => {
    expect(declaredHosts("default-src 'self'; connect-src 'self' api.exemple.fr *.cdn.fr; object-src 'none'")).toEqual(['api.exemple.fr', '*.cdn.fr'])
    expect(declaredHosts("default-src 'self'; connect-src 'self'")).toEqual([])
    expect(declaredHosts(undefined)).toEqual([])
  })

  it('blocks non proxied UDP for WebRTC', () => {
    expect(LOCKED_WEBRTC_POLICY).toBe('disable_non_proxied_udp')
  })
})

function contents(type: string) {
  return Object.assign(new EventEmitter(), { getType: () => type, setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(), session: h.guestSession, hostWebContents: { send: vi.fn() } })
}

describe('web security', () => {
  beforeEach(() => {
    h.app.removeAllListeners()
    installWebSecurity({
      guestPreload: '/app/preload/shellGuest.js',
      hardeningDisabled: () => false,
      guestKeys: () => [],
      isPreparedPartition: (partition) => partition === 'persist:ws-abcdefghijklmnop' || partition.startsWith('app-'),
      guestKinds: [{ id: 'app', matches: (partition) => partition.startsWith('app-'), preload: '/app/preload/appPanel.js', browser: false }],
      platform: 'darwin',
    })
  })

  const attach = (partition: string | undefined, src = 'https://example.com', preload = '/evil.js') => {
    const host = contents('window')
    h.app.emit('web-contents-created', {}, host)
    const event = { preventDefault: vi.fn() }
    const webPreferences: Record<string, unknown> = { partition, preload, nodeIntegration: true, sandbox: false }
    const params: Record<string, unknown> = { src }
    host.emit('will-attach-webview', event, webPreferences, params)
    return { event, webPreferences, params }
  }

  it('pins the guest preload and sandbox on a prepared workspace partition', () => {
    const { event, webPreferences, params } = attach('persist:ws-abcdefghijklmnop')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences).toMatchObject({ preload: '/app/preload/shellGuest.js', nodeIntegration: false, sandbox: true, contextIsolation: true })
    expect(params.allowpopups).toBe('true')
    expect(h.guestSession.setUserAgent).toHaveBeenCalledWith('Mozilla/5.0 Chrome/140.0.0.0', 'en')
  })

  it('gives a custom panel its own preload and a locked session: no popup, no permission, no browser identity', () => {
    const { event, webPreferences, params } = attach('app-abcdefghijklmnop-notes', 'http://127.0.0.1:4000/t/notes/index.html')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences).toMatchObject({ preload: '/app/preload/appPanel.js', nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true })
    expect(params.allowpopups).not.toBe('true')
    expect(h.appSession.setUserAgent).not.toHaveBeenCalled()
    const grant = vi.fn()
    ;(h.appSession.setPermissionRequestHandler.mock.calls[0][0] as (...args: unknown[]) => void)({}, 'cookies', grant)
    ;(h.appSession.setPermissionRequestHandler.mock.calls[0][0] as (...args: unknown[]) => void)({}, 'media', grant)
    expect(grant.mock.calls).toEqual([[false], [false]])
    expect((h.appSession.setPermissionCheckHandler.mock.calls[0][0] as () => boolean)()).toBe(false)
  })

  describe('a custom panel page never leaves the origin that serves it', () => {
    const SRC = 'http://127.0.0.1:4000/token/notes/index.html'
    let n = 0
    const open = () => {
      const partition = `app-abcdefghijklmnop-fresh${++n}`
      attach(partition, SRC)
      const session = h.fresh.get(partition)!
      const guest = Object.assign(contents('webview'), { session })
      h.app.emit('web-contents-created', {}, guest)
      const request = (resourceType: string, url: string) => {
        const callback = vi.fn()
        const handler = session.webRequest.onBeforeRequest.mock.calls[0][0] as (details: unknown, callback: (response: { cancel?: boolean }) => void) => void
        handler({ resourceType, url }, callback)
        return callback.mock.calls[0][0] as { cancel?: boolean }
      }
      /** The page server answers a main frame with its policy. */
      const respond = (url: string, csp: string) => {
        const callback = vi.fn()
        const handler = session.webRequest.onHeadersReceived.mock.calls[0][0] as (details: unknown, callback: (response: object) => void) => void
        handler({ resourceType: 'mainFrame', url, responseHeaders: { 'Content-Security-Policy': [csp] } }, callback)
        expect(callback).toHaveBeenCalledWith({})
      }
      return { guest, request, respond, partition }
    }

    it('cancels a main frame request to another site or port, redirects included, and keeps its own origin', () => {
      const { request } = open()
      expect(request('mainFrame', SRC).cancel).toBeFalsy()
      expect(request('mainFrame', 'http://127.0.0.1:4000/token/notes/pages/b.html').cancel).toBeFalsy()
      for (const url of ['https://evil.example/?d=secret', 'http://127.0.0.1:4001/x', 'http://localhost:4000/x', 'data:text/html,hi', 'about:blank', 'file:///etc/passwd']) {
        expect(request('mainFrame', url).cancel, url).toBe(true)
      }
    })

    it('lets a request to a host the page policy declares through, and cancels one to any other host', () => {
      const { request, respond } = open()
      expect(request('xhr', 'https://api.exemple.fr/data').cancel).toBe(true)
      respond(SRC, "default-src 'self'; connect-src 'self' api.exemple.fr")
      expect(request('xhr', 'https://api.exemple.fr/data').cancel).toBeFalsy()
      expect(request('other', 'https://evil.example/prefetch').cancel).toBe(true)
      expect(request('script', 'http://127.0.0.1:4000/token/notes/app.js').cancel).toBeFalsy()
    })

    it('ignores a policy from another origin than the page', () => {
      const { request, respond } = open()
      respond('http://127.0.0.1:4001/x', "connect-src 'self' evil.example")
      expect(request('xhr', 'https://evil.example/').cancel).toBe(true)
    })

    it('keeps only the current origin when the page server moves to another port (FR-005)', () => {
      const { request, respond, partition } = open()
      respond(SRC, "connect-src 'self' api.exemple.fr")
      attach(partition, 'http://127.0.0.1:4001/token/notes/index.html')
      expect(request('mainFrame', 'http://127.0.0.1:4001/token/notes/index.html').cancel).toBeFalsy()
      expect(request('mainFrame', SRC).cancel).toBe(true)
      // The hosts were those of the old page: the new one has not answered yet.
      expect(request('xhr', 'https://api.exemple.fr/data').cancel).toBe(true)
    })

    it('blocks non proxied UDP for WebRTC in a custom panel page, not in a browser page', () => {
      const { guest } = open()
      expect(guest.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
      attach('persist:ws-abcdefghijklmnop')
      const browser = contents('webview')
      h.app.emit('web-contents-created', {}, browser)
      expect(browser.setWebRTCIPHandlingPolicy).not.toHaveBeenCalled()
    })

    it('stops will-navigate and will-redirect to another origin before the request leaves', () => {
      const { guest } = open()
      for (const eventName of ['will-navigate', 'will-redirect']) {
        const bad = { preventDefault: vi.fn() }
        guest.emit(eventName, bad, 'https://evil.example/?d=secret')
        expect(bad.preventDefault, eventName).toHaveBeenCalled()
        const good = { preventDefault: vi.fn() }
        guest.emit(eventName, good, 'http://127.0.0.1:4000/token/notes/b.html')
        expect(good.preventDefault, eventName).not.toHaveBeenCalled()
      }
    })

    it('opens no window from the page', () => {
      const { guest } = open()
      const handler = guest.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => { action: string }
      expect(handler({ url: 'https://evil.example' })).toEqual({ action: 'deny' })
    })
  })

  it('does not turn a custom panel popup into a browser tab, nor its keys into browser shortcuts', () => {
    attach('app-abcdefghijklmnop-notes')
    const guest = Object.assign(contents('webview'), { session: h.appSession })
    h.app.emit('web-contents-created', {}, guest)
    const open = guest.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => { action: string }
    expect(open({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    guest.emit('before-input-event', event, { type: 'keyDown', meta: true, control: false, shift: false, alt: false, code: 'KeyR', key: 'r' })
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('refuses a guest outside a prepared workspace partition (loopback must mean the runtime)', () => {
    expect(attach(undefined).event.preventDefault).toHaveBeenCalled()
    expect(attach('persist:other').event.preventDefault).toHaveBeenCalled()
    expect(attach('persist:ws-abcdefghijklmnop', 'javascript:alert(1)').event.preventDefault).toHaveBeenCalled()
  })

  it('keeps app windows on the app', () => {
    expect(isTrustedAppUrl('file:///app/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isTrustedAppUrl('https://evil.test/', 'http://localhost:5173')).toBe(false)
    const host = contents('window')
    h.app.emit('web-contents-created', {}, host)
    const event = { preventDefault: vi.fn() }
    host.emit('will-navigate', event, 'https://evil.test/')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('allows only web, file and data pages in guests', () => {
    for (const url of ['about:blank', 'https://a.test', 'http://localhost:3000', 'data:text/html,hi']) expect(isAllowedGuestUrl(url)).toBe(true)
    // A client's disk is never a page: workspace files come from the runtime's file server.
    for (const url of ['javascript:alert(1)', 'chrome://settings', 'file:///x.html', 'not a url']) expect(isAllowedGuestUrl(url)).toBe(false)
  })

  it('maps guest keys to browser actions and forwarded canvas shortcuts', () => {
    const key = { type: 'keyDown' as const, meta: true, control: false, shift: false, alt: false }
    expect(browserActionForInput({ ...key, code: 'KeyR' }, 'darwin')).toBe('reload')
    expect(browserActionForInput({ ...key, shift: true, code: 'KeyR' }, 'darwin')).toBe('reloadHard')
    expect(browserActionForInput({ ...key, code: 'KeyR' }, 'win32')).toBeNull()
    const guestKeys = [{ action: 'commandPalette', shortcut: { key: 'k', command: true, shift: false, option: false, control: false } }]
    expect(forwardedActionForInput({ ...key, key: 'k' }, guestKeys, 'darwin')).toBe('commandPalette')
    expect(forwardedActionForInput({ ...key, key: 't' }, guestKeys, 'darwin')).toBeNull()
  })
})

describe('installAppCsp', () => {
	it('lets the renderer play a blob: or same-origin video and audio (media-src)', () => {
		h.appSession.webRequest.onHeadersReceived.mockClear()
		installAppCsp(undefined)
		const handler = h.appSession.webRequest.onHeadersReceived.mock.calls[0][0] as (details: unknown, callback: (response: { responseHeaders: Record<string, string[]> }) => void) => void
		const callback = vi.fn()
		handler({ url: 'file:///app/index.html', responseHeaders: {} }, callback)
		const csp = callback.mock.calls[0][0].responseHeaders['Content-Security-Policy'][0]
		const media = csp.split(';').map((d: string) => d.trim()).find((d: string) => d.startsWith('media-src'))
		expect(media?.split(' ')).toEqual(expect.arrayContaining(["'self'", 'blob:']))
	})
})
