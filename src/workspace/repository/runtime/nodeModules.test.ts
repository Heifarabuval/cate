import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { testGitHost } from '../../../test/testGit'
import { cloneNodeModules } from './nodeModules'

const macTest = test.skipIf(process.platform !== 'darwin')

describe('cloneNodeModules', () => {
  let tmp: string
  let root: string
  let target: string

  const exists = (p: string) => fs.stat(p).then(() => true, () => false)

  async function seed(dir: string, lock: string | null) {
    await fs.mkdir(dir, { recursive: true })
    if (lock !== null) await fs.writeFile(path.join(dir, 'package-lock.json'), lock)
  }

  async function addModules(dir: string) {
    await fs.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    await fs.mkdir(path.join(dir, 'node_modules', '.bin'), { recursive: true })
    await fs.writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'ok\n')
    await fs.symlink('../pkg/index.js', path.join(dir, 'node_modules', '.bin', 'pkg'))
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cate-nm-'))
    root = path.join(tmp, 'root')
    target = path.join(tmp, 'target')
  })

  afterEach(async () => {
    await fs.chmod(path.join(root, 'node_modules', 'pkg', 'index.js'), 0o644).catch(() => {})
    await fs.rm(tmp, { recursive: true, force: true })
  })

  macTest('clones node_modules when the lockfile is identical', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-a')
    await addModules(root)

    await cloneNodeModules(root, target)

    expect(await fs.readFile(path.join(target, 'node_modules', 'pkg', 'index.js'), 'utf-8')).toBe('ok\n')
  })

  macTest('keeps relative symlinks of .bin as links', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-a')
    await addModules(root)

    await cloneNodeModules(root, target)

    const link = path.join(target, 'node_modules', '.bin', 'pkg')
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect(await fs.readlink(link)).toBe('../pkg/index.js')
  })

  macTest('does nothing without a source node_modules', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-a')

    await cloneNodeModules(root, target)

    expect(await exists(path.join(target, 'node_modules'))).toBe(false)
  })

  macTest('does nothing when the lockfiles differ', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-b')
    await addModules(root)

    await cloneNodeModules(root, target)

    expect(await exists(path.join(target, 'node_modules'))).toBe(false)
  })

  macTest('does nothing without any lockfile', async () => {
    await seed(root, null)
    await seed(target, null)
    await addModules(root)

    await cloneNodeModules(root, target)

    expect(await exists(path.join(target, 'node_modules'))).toBe(false)
  })

  macTest('never overwrites an existing node_modules', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-a')
    await addModules(root)
    await fs.mkdir(path.join(target, 'node_modules'))
    await fs.writeFile(path.join(target, 'node_modules', 'mine'), 'keep\n')

    await cloneNodeModules(root, target)

    expect(await fs.readFile(path.join(target, 'node_modules', 'mine'), 'utf-8')).toBe('keep\n')
    expect(await exists(path.join(target, 'node_modules', 'pkg'))).toBe(false)
  })

  macTest('removes the partial copy and does not throw when cp fails', async () => {
    await seed(root, 'lock-a')
    await seed(target, 'lock-a')
    await addModules(root)
    await fs.chmod(path.join(root, 'node_modules', 'pkg', 'index.js'), 0o000)

    await expect(cloneNodeModules(root, target)).resolves.toBeUndefined()

    expect(await exists(path.join(target, 'node_modules'))).toBe(false)
  })
})

describe('addWorktree and node_modules', () => {
  let repo: string
  let target: string

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'cate-nm-wt-'))
    target = path.join(repo, '.cate', 'worktrees', 'feat')
    const git = simpleGit(repo)
    await git.init()
    await git.addConfig('user.name', 'Cate Test')
    await git.addConfig('user.email', 'cate@example.test')
    await fs.writeFile(path.join(repo, 'package-lock.json'), 'lock-a')
    await git.add('package-lock.json')
    await git.commit('initial')
    await fs.mkdir(path.join(repo, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'ok\n')
  })

  afterEach(async () => {
    await fs.chmod(path.join(repo, 'node_modules', 'pkg', 'index.js'), 0o644).catch(() => {})
    await fs.rm(repo, { recursive: true, force: true })
  })

  macTest('clones node_modules into the new worktree', async () => {
    await testGitHost().addWorktree({ cwd: repo, branch: 'feat', targetPath: target, createBranch: true })

    expect(await fs.readFile(path.join(target, 'node_modules', 'pkg', 'index.js'), 'utf-8')).toBe('ok\n')
  })

  macTest('still returns the worktree when the clone fails', async () => {
    await fs.chmod(path.join(repo, 'node_modules', 'pkg', 'index.js'), 0o000)

    const result = await testGitHost().addWorktree({ cwd: repo, branch: 'feat', targetPath: target, createBranch: true })

    expect(result).toEqual({ path: target, branch: 'feat' })
    await expect(fs.stat(path.join(target, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
