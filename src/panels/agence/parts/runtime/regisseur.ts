// The `agence` CLI's regisseur (`agence watch --token-stdin`): one process per
// repository root in the daemon, shared by every agence session of that root
// (reference count), stopped with SIGTERM when the last one lets go.
//
// - The form token goes on its stdin only, never in its argv or environment;
//   stdin stays open, its end tells the CLI the daemon died.
// - Its `cate` CLI lease (socket, CLI token, PATH) belongs to the process:
//   taken when it starts, revoked when it exits. The token names one panel of
//   the root (the owner); the runtime revokes a removed panel's tokens, so
//   when the owner goes and others remain, the process restarts in a
//   remaining panel's name.
// - It runs only in a trusted workspace (architecture 9.2): no spawn without
//   trust, stopped when trust is revoked, started again when it is granted.
// - A process that dies on its own stays `stopped` with its reason; `restart()`
//   or a new reference starts it again, nothing restarts it by itself.
// - A new process waits for the previous one of its root to exit, so it never
//   finds the port taken.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { RegisseurView } from '../../contract/types'

export interface RegisseurLease {
  env: Record<string, string>
  revoke(): void
}

export interface RegisseursOptions {
  /** The `cate` CLI env of a process in `panelId`'s name (PanelServices.cliEnv). */
  cliEnv(panelId: string): Promise<RegisseurLease>
  trust: {
    isTrusted(): boolean
    requireTrusted(): void
    onChange(listener: (state: { trusted: boolean }) => void): () => void
  }
  /** The `agence` executable (default: `agence` on the lease's PATH). */
  command?: string
  /** Arguments before `watch --token-stdin` (tests: a script for node). */
  commandArgs?: string[]
  /** How long a SIGTERM gets before SIGKILL. */
  killAfterMs?: number
}

export interface RegisseurAcquire {
  root: string
  /** The panel taking the reference: the lease may be in its name. */
  panelId: string
  /** The regisseur's port, from the CLI's state; null while unknown. */
  port: () => number | null
}

export interface RegisseurReply { code: number; message: string }

export interface RegisseurHandle {
  view(): RegisseurView
  onChange(listener: (view: RegisseurView) => void): () => void
  /** A form POST with the token and `Accept: application/json`: the CLI's
   *  `{code, message}`, refusals included. Rejects with
   *  `regisseur-unavailable` when the process does not run. */
  post(path: string, form: Record<string, string>): Promise<RegisseurReply>
  /** Starts the process again when it is not running nor starting; false
   *  otherwise (and without trust: trust coming back starts it). */
  restart(): boolean
  /** Idempotent. */
  release(): void
}

export interface Regisseurs {
  acquire(request: RegisseurAcquire): RegisseurHandle
  /** Live processes. */
  running(): number
  /** Releases every reference and waits for every process to exit (SIGKILL
   *  after `killAfterMs`): the workspace's shutdown. */
  dispose(): Promise<void>
}

/** Why a process is being stopped: decides the view once it exited. */
type StopReason = 'released' | 'owner' | 'untrusted'

interface Proc {
  child: ChildProcess | null
  token: string
  owner: RegisseurHandle
  exited: Promise<void>
  stop: StopReason | null
}

interface Entry {
  root: string
  refs: Map<RegisseurHandle, RegisseurAcquire>
  view: RegisseurView
  listeners: Set<(view: RegisseurView) => void>
  proc: Proc | null
  /** A start is under way (waiting for the previous process, the lease, the spawn). */
  starting: boolean
}

const POST_TIMEOUT_MS = 60_000
const READY = 'régisseur sur http'
const SETTINGS = 'réglages CLI du workspace'
const UNTRUSTED = 'workspace not trusted: the regisseur starts once trust is granted'

export function createRegisseurs(options: RegisseursOptions): Regisseurs {
  const command = options.command ?? 'agence'
  const killAfterMs = options.killAfterMs ?? 3000
  const entries = new Map<string, Entry>()
  /** The last process of each root, until it exits. */
  const exiting = new Map<string, Promise<void>>()
  const procs = new Set<Proc>()
  let live = 0
  let disposed = false

  const set = (entry: Entry, patch: Partial<RegisseurView>): void => {
    const next = { ...entry.view, ...patch }
    if (JSON.stringify(next) === JSON.stringify(entry.view)) return
    entry.view = next
    for (const listener of [...entry.listeners]) {
      try { listener(next) } catch { /* a listener must not break the others */ }
    }
  }

  const current = (entry: Entry): boolean => entries.get(entry.root) === entry && entry.refs.size > 0 && !disposed

  const stop = (proc: Proc, reason: StopReason): void => {
    if (proc.stop) return
    proc.stop = reason
    const child = proc.child
    if (!child) return
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs)
    void proc.exited.then(() => clearTimeout(timer))
  }

  /** Starts the entry's process once the previous one of its root exited. */
  const start = async (entry: Entry): Promise<void> => {
    if (entry.starting || entry.proc) return
    entry.starting = true
    set(entry, { state: 'starting', error: null })
    try {
      await exiting.get(entry.root)
      if (!current(entry)) return
      if (!options.trust.isTrusted()) return set(entry, { state: 'stopped', error: UNTRUSTED })
      const [owner, request] = [...entry.refs][0]
      let lease: RegisseurLease
      try {
        lease = await options.cliEnv(request.panelId)
      } catch (error) {
        return set(entry, { state: 'stopped', error: `cate CLI env: ${(error as Error).message}` })
      }
      if (!current(entry) || !options.trust.isTrusted() || !entry.refs.has(owner)) {
        lease.revoke()
        if (current(entry) && !options.trust.isTrusted()) set(entry, { state: 'stopped', error: UNTRUSTED })
        else if (current(entry)) { entry.starting = false; return await start(entry) }
        return
      }
      try {
        options.trust.requireTrusted()
      } catch (error) {
        lease.revoke()
        return set(entry, { state: 'stopped', error: (error as Error).message })
      }
      spawnProcess(entry, owner, lease)
    } finally {
      entry.starting = false
    }
  }

  const spawnProcess = (entry: Entry, owner: RegisseurHandle, lease: RegisseurLease): void => {
    let done!: () => void
    const exited = new Promise<void>((resolve) => { done = resolve })
    const proc: Proc = { child: null, token: randomBytes(24).toString('base64url'), owner, exited, stop: null }
    procs.add(proc)
    entry.proc = proc
    exiting.set(entry.root, exited)
    let finished = false
    const finish = (view: Partial<RegisseurView>): void => {
      if (finished) return
      finished = true
      lease.revoke()
      procs.delete(proc)
      if (exiting.get(entry.root) === exited) exiting.delete(entry.root)
      if (entry.proc === proc) entry.proc = null
      if (proc.stop === 'untrusted') set(entry, { state: 'stopped', error: UNTRUSTED })
      else if (proc.stop === 'released') set(entry, { state: 'stopped', error: null })
      else if (proc.stop !== 'owner') set(entry, view)
      else if (!current(entry)) set(entry, { state: 'stopped', error: null })
      done()
      // The owner went and others remain: start again in their name.
      if (proc.stop === 'owner' && current(entry)) void start(entry)
    }

    let child: ChildProcess
    try {
      child = spawn(command, [...(options.commandArgs ?? []), 'watch', '--token-stdin'], {
        cwd: entry.root,
        env: { ...lease.env, AGENCE_ROOT: entry.root },
        stdio: ['pipe', 'ignore', 'pipe'],
      })
    } catch (error) {
      return finish({ state: 'missing', error: `agence introuvable (${command}) : ${(error as Error).message}` })
    }
    proc.child = child
    let lastLine = ''
    let pending = ''
    child.on('spawn', () => { live += 1 })
    child.on('error', (error: NodeJS.ErrnoException) => {
      // The process never started (ENOENT, EACCES): no exit follows.
      if (child.pid !== undefined) return
      finish({ state: 'missing', error: error.code === 'ENOENT' ? `agence introuvable (${command})` : `agence ne démarre pas : ${error.message}` })
    })
    // The CLI may exit before it reads stdin (no port, no CATE_SOCKET).
    child.stdin?.on('error', () => {})
    child.stdin?.write(`${proc.token}\n`)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        lastLine = line
        if (line.includes(READY) && !proc.stop) set(entry, { state: 'running', error: null })
        const hint = line.indexOf(SETTINGS)
        if (hint >= 0) set(entry, { settingsHint: line.slice(hint) })
      }
    })
    child.on('exit', (code, signal) => {
      live -= 1
      const line = (pending.trim() || lastLine).replace(/^agence ?: ?/, '')
      if (line.includes('déjà actif sur')) finish({ state: 'external', error: line })
      else if (/unrecognized arguments|invalid choice/.test(line)) finish({ state: 'missing', error: line })
      else finish({ state: 'stopped', error: line && !line.includes(READY) ? line : `agence watch s'est arrêté (${signal ?? code})` })
    })
  }

  const offTrust = options.trust.onChange(({ trusted }) => {
    for (const entry of entries.values()) {
      if (!trusted) {
        if (entry.proc) stop(entry.proc, 'untrusted')
        else if (!entry.starting) set(entry, { state: 'stopped', error: UNTRUSTED })
      } else if (!entry.proc) void start(entry)
    }
  })

  const acquire = (request: RegisseurAcquire): RegisseurHandle => {
    const { root } = request
    let entry = entries.get(root)
    if (!entry) {
      entry = { root, refs: new Map(), listeners: new Set(), proc: null, starting: false, view: { state: 'starting', error: null, settingsHint: null } }
      entries.set(root, entry)
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
        const proc = owner.proc
        if (owner.view.state !== 'running' || !proc || proc.stop || !port) throw new Error('regisseur-unavailable')
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ ...form, token: proc.token }).toString(),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        })
        const reply = await response.json() as Partial<RegisseurReply>
        if (typeof reply.code !== 'number' || typeof reply.message !== 'string') throw new Error('regisseur-bad-reply')
        return { code: reply.code, message: reply.message }
      },
      restart() {
        if (released || owner.proc || owner.starting || !current(owner) || !options.trust.isTrusted()) return false
        void start(owner)
        return true
      },
      release() {
        if (released) return
        released = true
        owner.refs.delete(handle)
        const proc = owner.proc
        if (!owner.refs.size) {
          if (entries.get(root) === owner) entries.delete(root)
          if (proc) stop(proc, 'released')
          else if (!owner.starting) set(owner, { state: 'stopped', error: null })
        } else if (proc?.owner === handle) {
          set(owner, { state: 'starting', error: null })
          stop(proc, 'owner')
        }
      },
    }
    owner.refs.set(handle, request)
    // A new reference starts a root whose process is not running.
    if (!owner.proc && !owner.starting) void start(owner)
    return handle
  }

  return {
    acquire,
    running: () => live,
    async dispose() {
      disposed = true
      offTrust()
      for (const entry of [...entries.values()]) for (const handle of [...entry.refs.keys()]) handle.release()
      for (const proc of procs) stop(proc, 'released')
      await Promise.all([...procs].map((proc) => proc.exited))
    },
  }
}
