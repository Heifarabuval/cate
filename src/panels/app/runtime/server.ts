// Serves the pages of custom panels over HTTP on the runtime's loopback (spec
// 008 P2): a second `createFileServer` whose scope is `~/.cate/panneaux/`
// alone, with the policy that keeps a page in its folder. One token per panel
// folder; a symlink out of the folder, `..`, or another panel's path is a 404.

import fs from 'node:fs'
import path from 'node:path'
import { createFileServer } from '@workspace/files/runtime'

export interface AppServer {
  /** The URL of `entry` (relative to the panel's folder) in panel `id`. */
  urlFor(id: string, entry: string): Promise<string>
  close(): Promise<void>
}

export interface AppServerDeps {
  /** `~/.cate/panneaux`. */
  dir: string
  isTrusted(): boolean
  /** The hosts the panel may call (`permissions.network`). */
  networkHosts(id: string): readonly string[]
}

/** The policy of a page: its own files only, no eval, no remote script, and
 *  the declared hosts for `fetch`. */
export function contentSecurityPolicy(hosts: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...hosts].join(' ')}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

export function createAppServer(deps: AppServerDeps): AppServer {
  const base = path.resolve(deps.dir)
  // The panels folder's real path, known before the first request (`urlFor` sets it).
  let realBase = base
  const inside = (real: string) => real === realBase || real.startsWith(realBase + path.sep)

  const server = createFileServer({
    isTrusted: deps.isTrusted,
    // The real path, and only inside the panels folder: anything else answers like a missing file.
    strict: async (p) => {
      const real = await fs.promises.realpath(p)
      if (!inside(real)) throw Object.assign(new Error('outside the panels folder'), { code: 'ENOENT' })
      return real
    },
    responseHeaders: (file) => {
      const id = path.relative(realBase, file).split(path.sep)[0]
      return { 'Content-Security-Policy': contentSecurityPolicy(deps.networkHosts(id)) }
    }
  })

  return {
    async urlFor(id, entry) {
      const folder = path.resolve(base, id)
      const relative = path.relative(folder, path.resolve(folder, entry))
      if (path.dirname(folder) !== base || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${id}/${entry} is not inside the panels folder`)
      }
      realBase = await fs.promises.realpath(base)
      // The token's scope is the panel's folder, so an entry in a subfolder keeps its relative links.
      const url = await server.urlFor(folder)
      return `${url}/${entry.split('/').map(encodeURIComponent).join('/')}`
    },
    close: () => server.close()
  }
}
