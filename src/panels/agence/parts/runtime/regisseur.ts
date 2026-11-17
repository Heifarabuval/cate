// The `agence` CLI's regisseur (`agence watch --token-stdin`): one process per
// repository root in the daemon, shared by every agence session of that root
// (reference count), stopped with SIGTERM when the last one lets go. The form
// token goes on its stdin only, never in its argv or environment, and stdin
// stays open: its end tells the CLI the daemon died. A new reference taken
// while the previous process is still exiting waits for it, so the new one
// does not find the port taken.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { RegisseurView } from '../../contract/types'

export interface RegisseursOptions {
  /** The `agence` executable (default: `agence` on the env's PATH). */
  command?: string
  /** Arguments before `watch --token-stdin` (tests: a script for node). */
  commandArgs?: string[]
  /** How long a SIGTERM gets before SIGKILL. */
  killAfterMs?: number
}

export interface RegisseurAcquire {
  root: string
  /** The regisseur's port, from the CLI's state; null while unknown. */
  port: () => number | null
  /** The process environment (the `cate` CLI env); `AGENCE_ROOT` is added.
   *  Only the first reference of a root starts the process. */
  env: Record<string, string>
}

export interface RegisseurReply { code: number; message: string }

export interface RegisseurHandle {
  view(): RegisseurView
  onChange(listener: (view: RegisseurView) => void): () => void
  /** A form POST with the token and `Accept: application/json`: the CLI's
   *  `{code, message}`, refusals included. Rejects with
   *  `regisseur-unavailable` when the process does not run. */
  post(path: string, form: Record<string, string>): Promise<RegisseurReply>
  /** Idempotent. */
  release(): void
}

export interface Regisseurs {
  acquire(request: RegisseurAcquire): RegisseurHandle
  /** Live processes. */
  running(): number
  /** Releases every reference (daemon shutdown). */
  dispose(): void
}

interface Entry {
  refs: Set<RegisseurHandle>
  view: RegisseurView
  listeners: Set<(view: RegisseurView) => void>
  token: string | null
  child: ChildProcess | null
  /** Resolves once the process exited (or never started). */
  exited: Promise<void>
  released: boolean
}

const POST_TIMEOUT_MS = 60_000
const READY = 'régisseur sur http'
const SETTINGS = 'réglages CLI du workspace'

export function createRegisseurs(options: RegisseursOptions = {}): Regisseurs {
  const command = options.command ?? 'agence'
  const killAfterMs = options.killAfterMs ?? 3000
  const entries = new Map<string, Entry>()
  /** The last process of a root, until it exits. */
  const exiting = new Map<string, Promise<void>>()
  let live = 0

  const set = (entry: Entry, patch: Partial<RegisseurView>): void => {
    const next = { ...entry.view, ...patch }
    if (JSON.stringify(next) === JSON.stringify(entry.view)) return
    entry.view = next
    for (const listener of [...entry.listeners]) {
      try { listener(next) } catch { /* a listener must not break the others */ }
    }
  }

  const start = (root: string, entry: Entry, env: Record<string, string>, done: () => void): void => {
    if (entry.released) return done()
    let child: ChildProcess
    try {
      child = spawn(command, [...(options.commandArgs ?? []), 'watch', '--token-stdin'], {
        cwd: root,
        env: { ...env, AGENCE_ROOT: root },
        stdio: ['pipe', 'ignore', 'pipe'],
      })
    } catch (error) {
      set(entry, { state: 'missing', error: `agence introuvable (${command}) : ${(error as Error).message}` })
      return done()
    }
    entry.child = child
    const token = randomBytes(24).toString('base64url')
    entry.token = token
    let lastLine = ''
    let pending = ''
    child.on('spawn', () => { live += 1 })
    child.on('error', (error: NodeJS.ErrnoException) => {
      // The process never started (ENOENT, EACCES): no exit follows.
      if (child.pid !== undefined) return
      entry.token = null
      set(entry, { state: 'missing', error: error.code === 'ENOENT' ? `agence introuvable (${command})` : `agence ne démarre pas : ${error.message}` })
      done()
    })
    // The CLI may exit before it reads stdin (no port, no CATE_SOCKET).
    child.stdin?.on('error', () => {})
    child.stdin?.write(`${token}\n`)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        lastLine = line
        if (line.includes(READY)) set(entry, { state: 'running', error: null })
        const hint = line.indexOf(SETTINGS)
        if (hint >= 0) set(entry, { settingsHint: line.slice(hint) })
      }
    })
    child.on('exit', (code, signal) => {
      live -= 1
      entry.token = null
      entry.child = null
      const line = (pending.trim() || lastLine).replace(/^agence ?: ?/, '')
      if (line.includes('déjà actif sur')) set(entry, { state: 'external', error: line })
      else if (/unrecognized arguments|invalid choice/.test(line)) set(entry, { state: 'missing', error: line })
      else if (entry.released) set(entry, { state: 'stopped', error: null })
      else set(entry, { state: 'stopped', error: line || `agence watch s'est arrêté (${signal ?? code})` })
      done()
    })
  }

  const acquire = (request: RegisseurAcquire): RegisseurHandle => {
    const { root } = request
    let entry = entries.get(root)
    if (!entry) {
      let done!: () => void
      const exited = new Promise<void>((resolve) => { done = resolve })
      const fresh: Entry = {
        refs: new Set(), listeners: new Set(), token: null, child: null, exited, released: false,
        view: { state: 'starting', error: null, settingsHint: null },
      }
      entry = fresh
      entries.set(root, fresh)
      const previous = exiting.get(root)
      exiting.set(root, exited)
      void exited.then(() => { if (exiting.get(root) === exited) exiting.delete(root) })
      if (previous) void previous.then(() => start(root, fresh, request.env, done))
      else start(root, fresh, request.env, done)
    }
    const owner = entry
    let released = false
    const handle: RegisseurHandle = {
      view: () => owner.view,
      onChange(listener) {
        owner.listeners.add(listener)
        return () => { owner.listeners.delete(listener) }
      },
      async post(path, form) {
        const port = request.port()
        const token = owner.token
        if (owner.view.state !== 'running' || !token || !port) throw new Error('regisseur-unavailable')
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ ...form, token }).toString(),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        })
        const reply = await response.json() as Partial<RegisseurReply>
        if (typeof reply.code !== 'number' || typeof reply.message !== 'string') throw new Error('regisseur-bad-reply')
        return { code: reply.code, message: reply.message }
      },
      release() {
        if (released) return
        released = true
        owner.refs.delete(handle)
        if (owner.refs.size) return
        owner.released = true
        if (entries.get(root) === owner) entries.delete(root)
        const child = owner.child
        if (!child) return
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs)
        timer.unref()
        void owner.exited.then(() => clearTimeout(timer))
      },
    }
    owner.refs.add(handle)
    return handle
  }

  return {
    acquire,
    running: () => live,
    dispose() {
      for (const entry of [...entries.values()]) for (const handle of [...entry.refs]) handle.release()
    },
  }
}
