// Fakes for the agence panel's e2e: a fake `agence` (the regisseur), a fake
// `gh` and a fake `claude` (the orchestrator's program), none of which reaches
// the real tools or GitHub.
//
// - The daemon takes its `agence` launcher from `<checkout>/tools/agence/agence`
//   when it runs from a bare bundle, `checkout` being two levels above the
//   bundle: a fake checkout under the test HOME whose `dist-runtime/runtime.cjs`
//   links to the real bundle gives the daemon the fake launcher.
// - `gh` is found on the daemon's PATH (`fake-bin/gh`), which the regisseur
//   inherits; the fake agence refuses to send if `gh` is anything else.
// - The orchestrator starts `claude`: `fake-bin/claude` just stays alive.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { RUNTIME_BUNDLE } from './electron-app'

export interface AgenceFakes {
  /** Env to launch the app with: PATH, the bundle and the fake checkout. */
  env: Record<string, string>
  /** `fake-bin/gh.log`, one JSON `{args, stdin}` per call. */
  ghCalls(): Array<{ args: string[]; stdin: string }>
  /** Makes every fake `gh` call fail with this message (null: works again). */
  failGh(message: string | null): void
  /** Every request the fake regisseur received (`posts.log`), whatever its answer. */
  posts(): Array<{ path: string; code: number }>
  /** The next click on this draft is refused with a 409 and this message. */
  refuseDraft(draftId: string, message: string): void
}

const sh = (node: string, script: string) => `#!/bin/sh\nexec "${node}" "$(dirname "$0")/${script}" "$@"\n`

function write(file: string, text: string, mode = 0o644): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  chmodSync(file, mode)
}

/** Installs the fakes under `home`. `mode: 'old'` makes the fake agence reject
 *  `--token-stdin`, as an agence too old for the panel does. */
export function installAgenceFakes(home: string, opts: { mode?: 'old' } = {}): AgenceFakes {
  const fixtures = __dirname
  const checkout = path.join(home, 'fake-checkout')
  const agenceDir = path.join(checkout, 'tools', 'agence')
  mkdirSync(path.join(checkout, 'dist-runtime'), { recursive: true })
  mkdirSync(agenceDir, { recursive: true })
  symlinkSync(RUNTIME_BUNDLE, path.join(checkout, 'dist-runtime', 'runtime.cjs'))
  copyFileSync(path.join(fixtures, 'fake-agence.cjs'), path.join(agenceDir, 'fake-agence.cjs'))
  write(path.join(agenceDir, 'agence'), sh(process.execPath, 'fake-agence.cjs'), 0o755)
  if (opts.mode) write(path.join(agenceDir, 'mode'), opts.mode)

  const bin = path.join(home, 'fake-bin')
  mkdirSync(bin, { recursive: true })
  copyFileSync(path.join(fixtures, 'fake-gh.cjs'), path.join(bin, 'fake-gh.cjs'))
  write(path.join(bin, 'gh'), sh(process.execPath, 'fake-gh.cjs'), 0o755)
  write(path.join(bin, 'claude'), '#!/bin/sh\necho FAKE_CLAUDE_READY\nexec sleep 100000\n', 0o755)
  // Login shells rebuild PATH (macOS path_helper): the fakes go first from the
  // test HOME's own profile too.
  const profile = `export PATH=${JSON.stringify(bin)}:"$PATH"\n`
  for (const file of ['.zprofile', '.zshrc', '.bash_profile', '.profile']) write(path.join(home, file), profile)

  return {
    env: {
      CATE_RUNTIME_BUNDLE: path.join(checkout, 'dist-runtime', 'runtime.cjs'),
      CATE_E2E_PATH_PREPEND: bin,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    ghCalls: () => (existsSync(path.join(bin, 'gh.log'))
      ? readFileSync(path.join(bin, 'gh.log'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : []),
    posts: () => (existsSync(path.join(agenceDir, 'posts.log'))
      ? readFileSync(path.join(agenceDir, 'posts.log'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : []),
    failGh: (message) => (message === null ? rmSync(path.join(bin, 'gh-fail'), { force: true }) : write(path.join(bin, 'gh-fail'), message)),
    refuseDraft(draftId, message) {
      const file = path.join(agenceDir, 'refuse.json')
      const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> : {}
      write(file, JSON.stringify({ ...current, [draftId]: message }))
    },
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

/** sha256 of the draft text as the regisseur hashes it. */
export const hashOf = (text: string): string => createHash('sha256').update(text.trim()).digest('hex')

export interface FakeNeed { id: string; title: string; kind?: string; ref?: string | null; owner?: string; status?: string; evidence?: string | null }
export interface FakeDraft { id: string; needId: string; cible: string; titre?: string | null; statut?: string; url?: string | null }

/** The state the `agence` CLI keeps in `<root>/.cate/tmp/agence/state.json`
 *  (`empty()` and `add_need` of agence.py), written atomically as the CLI does. */
export function writeAgenceState(root: string, state: { port: number; repo?: string; needs: FakeNeed[]; drafts: FakeDraft[] }): void {
  const dir = path.join(root, '.cate', 'tmp', 'agence')
  mkdirSync(path.join(dir, 'drafts'), { recursive: true })
  const stamp = '2026-11-18T09:00:00+00:00'
  const needs = state.needs.map((need) => ({
    kind: 'draft', ref: null, owner: 'heifara', blocking: false, unblocks: null, source: null, panels: [], doneWhen: null,
    acceptance: null, budgetMin: null, evidence: null, status: 'open', closeFailed: false, agentBlocked: false,
    overBudget: false, created: stamp, createdTs: 1795428000, updated: stamp, ...need,
  }))
  const drafts = state.drafts.map((draft) => ({ titre: null, statut: 'à valider', texte: null, hash: null, url: null, agent: null, ...draft }))
  const next = {
    repo: state.repo ?? 'site', ghRepo: 'acme/site', panels: {}, port: state.port, seq: 9, needs, drafts, questions: [],
    notified: [], agentsActive: 0, agentsWaiting: 0, titles: {}, notify: true,
  }
  const tmp = path.join(dir, 'tmp-state-e2e')
  writeFileSync(tmp, JSON.stringify(next, null, 1))
  renameSync(tmp, path.join(dir, 'state.json'))
}

export function writeDraftText(root: string, draftId: string, text: string): void {
  const dir = path.join(root, '.cate', 'tmp', 'agence', 'drafts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${draftId}.md`), text.trim() + '\n')
}
