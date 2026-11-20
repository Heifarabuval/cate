import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createAppServer, type AppServer } from './server'

let base: string
let panneaux: string
let outside: string
let trusted: boolean
let hosts: Record<string, string[]>
let server: AppServer

const put = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
/** A request with the path as written: `fetch` would fold `%2e%2e`. */
const raw = (url: string, rawPath: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const target = new URL(url)
    http.get({ host: target.hostname, port: target.port, path: rawPath }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    }).on('error', reject)
  })

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'app-server-')))
  panneaux = path.join(base, 'panneaux')
  outside = path.join(base, 'dehors')
  trusted = true
  hosts = {}
  put(path.join(panneaux, 'a', 'index.html'), '<script src="app.js"></script>')
  put(path.join(panneaux, 'a', 'app.js'), 'run()')
  put(path.join(panneaux, 'a', 'pages', 'accueil.html'), '<p>accueil</p>')
  put(path.join(panneaux, 'b', 'index.html'), '<p>b</p>')
  put(path.join(outside, 'secret.txt'), 'SECRET')
  fs.symlinkSync(outside, path.join(panneaux, 'a', 'lien'))
  server = createAppServer({ dir: panneaux, isTrusted: () => trusted, networkHosts: (id) => hosts[id] ?? [] })
})
afterEach(async () => {
  await server.close()
  fs.rmSync(base, { recursive: true, force: true })
})

it('serves the page with a policy that allows nothing remote and no eval', async () => {
  const res = await fetch(await server.urlFor('a', 'index.html'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  const csp = res.headers.get('content-security-policy') ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("connect-src 'self'")
  expect(csp).not.toMatch(/unsafe-eval|unsafe-inline.*script|\*/)
  expect(csp.match(/script-src[^;]*/)?.[0]).toBe("script-src 'self'")
  expect(csp.match(/connect-src[^;]*/)?.[0]).toBe("connect-src 'self'")
})

it('adds the declared hosts, and only them, to connect-src', async () => {
  hosts.a = ['api.exemple.fr', '*.cdn.exemple.fr']
  const csp = (await fetch(await server.urlFor('a', 'index.html'))).headers.get('content-security-policy')
  expect(csp?.match(/connect-src[^;]*/)?.[0]).toBe("connect-src 'self' api.exemple.fr *.cdn.exemple.fr")
})

it('serves the files of its folder, an entry in a subfolder included, with relative links', async () => {
  const page = await server.urlFor('a', 'pages/accueil.html')
  expect(await (await fetch(page)).text()).toBe('<p>accueil</p>')
  expect(await (await fetch(new URL('../app.js', page))).text()).toBe('run()')
})

it('answers 404 outside the folder: after .., through a symlink, in another panel', async () => {
  const url = await server.urlFor('a', 'index.html')
  const token = new URL(url).pathname.split('/')[1]
  const folderA = path.join(panneaux, 'a')
  const encoded = (p: string) => p.split('/').map(encodeURIComponent).join('/')
  expect((await raw(url, `/${token}/${encoded(folderA).slice(1)}/%2e%2e/b/index.html`)).status).toBe(404)
  expect((await raw(url, `/${token}/${encoded(path.join(folderA, 'lien', 'secret.txt')).slice(1)}`)).status).toBe(404)
  expect((await raw(url, `/${token}/${encoded(path.join(panneaux, 'b', 'index.html')).slice(1)}`)).status).toBe(404)
  const secret = await raw(url, `/${token}/${encoded(path.join(outside, 'secret.txt')).slice(1)}`)
  expect(secret.status).toBe(404)
  expect(secret.body).not.toContain('SECRET')
})

it('keeps one token per panel: a token of b never reaches a', async () => {
  const urlB = await server.urlFor('b', 'index.html')
  const tokenB = new URL(urlB).pathname.split('/')[1]
  const encoded = path.join(panneaux, 'a', 'index.html').split('/').map(encodeURIComponent).join('/').slice(1)
  expect((await raw(urlB, `/${tokenB}/${encoded}`)).status).toBe(404)
})

it('refuses a panel that is not a folder of the panels directory', async () => {
  await expect(server.urlFor('../dehors', 'secret.txt')).rejects.toThrow()
  await expect(server.urlFor('a', '../../dehors/secret.txt')).rejects.toThrow()
})

it('serves script pages as plain text while the workspace is not trusted', async () => {
  trusted = false
  const res = await fetch(await server.urlFor('a', 'index.html'))
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
})
