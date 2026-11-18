// The `cate` CLI environment for a process a panel session starts without a
// PTY (the agence panel's regisseur): the socket, a token of its own in the
// panel's name, and `cate` on PATH. The launcher is shared and holds no
// token, it runs the CLI with the process's env; the PTY launchers of
// `terminal/runtime/cateCli` bake their token in, so a lease never touches
// them and never revokes a PTY's token.

import path from 'node:path'
import { writeFileAtomic } from '@kernel/state/node'

export interface CliEnvDeps {
  /** The workspace's private launcher directory (the terminal CLI's). */
  launcherDir: string
  nodePath: string
  cliPath: string
  /** The install's `agence` launcher, called by absolute path. */
  agencePath: string
  socketPath: string
  mintToken(panelId: string): string
  revokeToken(token: string): void
  /** The environment a lease starts from. */
  baseEnv(): Record<string, string | undefined>
}

export interface CliEnvLease {
  env: Record<string, string>
  /** Revokes the lease's token. Idempotent. */
  revoke(): void
}

export interface CliEnvRuntime {
  cliEnv(panelId: string): Promise<CliEnvLease>
  /** Revokes every outstanding lease. */
  dispose(): void
}

const shQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export function createCliEnv(deps: CliEnvDeps): CliEnvRuntime {
  const binDir = path.join(deps.launcherDir, 'process-env')
  const live = new Set<string>()
  let written: Promise<void> | null = null
  const writeLauncher = (): Promise<void> => {
    written ??= writeFileAtomic(
      path.join(binDir, 'cate'),
      `#!/bin/sh\nexec ${shQuote(deps.nodePath)} ${shQuote(deps.cliPath)} "$@"\n`,
      { mode: 0o700 },
    ).catch((error: unknown) => { written = null; throw error })
    return written
  }
  // At every lease, like the terminal launcher: a hard-killed daemon leaves
  // one pointing at an install since pruned. Not shipped on Windows.
  const writeAgence = async (): Promise<void> => {
    if (process.platform === 'win32') return
    await writeFileAtomic(path.join(binDir, 'agence'), `#!/bin/sh\nexec ${shQuote(deps.agencePath)} "$@"\n`, { mode: 0o700 })
  }

  return {
    async cliEnv(panelId) {
      await writeLauncher()
      await writeAgence()
      const token = deps.mintToken(panelId)
      live.add(token)
      const base = Object.fromEntries(Object.entries(deps.baseEnv()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      const env = {
        ...base,
        PATH: base.PATH ? binDir + path.delimiter + base.PATH : binDir,
        CATE_SOCKET: deps.socketPath,
        CATE_TOKEN: token,
      }
      return {
        env,
        revoke() {
          if (!live.delete(token)) return
          deps.revokeToken(token)
        },
      }
    },
    dispose() {
      for (const token of live) deps.revokeToken(token)
      live.clear()
    },
  }
}
