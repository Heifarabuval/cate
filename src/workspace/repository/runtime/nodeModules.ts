import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
const CLONE_TIMEOUT_MS = 60_000

const exists = (p: string) => fsp.stat(p).then(() => true, () => false)

/**
 * Clones the root's node_modules into a new worktree with copy-on-write
 * (`cp -c`, APFS), so the worktree can run tests without `npm ci`.
 * Only when the first lockfile of the root is byte-identical in the target.
 * Never throws: any failure leaves the worktree without node_modules.
 */
export async function cloneNodeModules(rootDir: string, targetPath: string): Promise<void> {
  if (process.platform !== 'darwin') return
  const source = path.join(rootDir, 'node_modules')
  const dest = path.join(targetPath, 'node_modules')
  try {
    if (!(await exists(source)) || (await exists(dest))) return
    const lockfile = await firstLockfile(rootDir)
    if (!lockfile) return
    const [a, b] = await Promise.all([
      fsp.readFile(path.join(rootDir, lockfile)),
      fsp.readFile(path.join(targetPath, lockfile))
    ])
    if (!a.equals(b)) return
    try {
      await execFileP('cp', ['-cR', source, dest], { timeout: CLONE_TIMEOUT_MS })
    } catch {
      await fsp.rm(dest, { recursive: true, force: true })
    }
  } catch {
    // Best effort: the worktree is usable without node_modules.
  }
}

async function firstLockfile(rootDir: string): Promise<string | undefined> {
  for (const name of LOCKFILES) if (await exists(path.join(rootDir, name))) return name
  return undefined
}
