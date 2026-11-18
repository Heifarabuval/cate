import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ApiTokenRegistry } from '@kernel/api/runtime'
import { createCateCliRuntime } from '@services/terminal/runtime'
import { createCliEnv, type CliEnvRuntime } from './cliEnv'

const execFileP = promisify(execFile)
let dir: string
let tokens: ApiTokenRegistry
let cliEnv: CliEnvRuntime
let cliPath: string
let agencePath: string
const launcherDir = () => path.join(dir, "workspace 'quoted' $dollar", 'terminal-cli')

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-cli-env-'))
  cliPath = path.join(dir, 'cli.cjs')
  fs.writeFileSync(cliPath, 'console.log(JSON.stringify({ socket: process.env.CATE_SOCKET, token: process.env.CATE_TOKEN, args: process.argv.slice(2) }))')
  agencePath = path.join(dir, 'agence-install', 'agence')
  fs.mkdirSync(path.dirname(agencePath))
  fs.writeFileSync(agencePath, '#!/bin/sh\necho "agence $CATE_TOKEN $*"\n', { mode: 0o755 })
  tokens = new ApiTokenRegistry()
  cliEnv = createCliEnv({
    launcherDir: launcherDir(),
    nodePath: process.execPath,
    cliPath,
    agencePath,
    socketPath: path.join(dir, 'runtime.sock'),
    mintToken: (panelId) => tokens.issue({ kind: 'cli', panelId }).token,
    revokeToken: (token) => tokens.revoke(token),
    baseEnv: () => ({ PATH: process.env.PATH, HOME: '/home/someone', UNSET: undefined }),
  })
})
afterEach(() => {
  cliEnv.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Runs `cate` the way a process given the env would: from its PATH. */
async function run(env: Record<string, string>) {
  const result = await execFileP('/bin/sh', ['-c', 'cate "with spaces"'], { env })
  return JSON.parse(result.stdout.trim()) as { socket: string; token: string; args: string[] }
}

it('gives a process the socket, a token in the panel\'s name and `cate` on its PATH', async () => {
  const lease = await cliEnv.cliEnv('agence-1')
  expect(lease.env.CATE_SOCKET).toBe(path.join(dir, 'runtime.sock'))
  expect(tokens.resolve(lease.env.CATE_TOKEN)?.panelId).toBe('agence-1')
  expect(lease.env.HOME).toBe('/home/someone')
  expect('UNSET' in lease.env).toBe(false)
  expect(await run(lease.env)).toEqual({ socket: lease.env.CATE_SOCKET, token: lease.env.CATE_TOKEN, args: ['with spaces'] })
})

it('writes no token on disk: the launcher reads the process env', async () => {
  const lease = await cliEnv.cliEnv('agence-1')
  const bin = lease.env.PATH.split(path.delimiter)[0]
  const launcher = fs.readFileSync(path.join(bin, 'cate'), 'utf8')
  expect(launcher).not.toContain(lease.env.CATE_TOKEN)
  expect(fs.statSync(path.join(bin, 'cate')).mode & 0o077).toBe(0)
})

it('puts agence next to cate: private, absolute, tokenless, run with the lease env', async () => {
  const lease = await cliEnv.cliEnv('agence-1')
  const bin = lease.env.PATH.split(path.delimiter)[0]
  const text = fs.readFileSync(path.join(bin, 'agence'), 'utf8')
  expect(text).toContain(agencePath)
  expect(text).not.toContain(lease.env.CATE_TOKEN)
  expect(fs.statSync(path.join(bin, 'agence')).mode & 0o777).toBe(0o700)
  const ran = await execFileP('/bin/sh', ['-c', 'agence "with spaces"'], { env: lease.env })
  expect(ran.stdout.trim()).toBe(`agence ${lease.env.CATE_TOKEN} with spaces`)
})

it('revokes the token at release, once', async () => {
  const lease = await cliEnv.cliEnv('agence-1')
  lease.revoke()
  lease.revoke()
  expect(tokens.resolve(lease.env.CATE_TOKEN)).toBeUndefined()
})

it('keeps the orchestrator PTY\'s token and launcher when the same panel takes leases', async () => {
  const terminalCli = createCateCliRuntime({
    launcherDir: launcherDir(),
    nodePath: process.execPath,
    cliPath,
    agencePath,
    socketPath: path.join(dir, 'runtime.sock'),
    mintToken: (panelId) => tokens.issue({ kind: 'cli', panelId }).token,
    revokeToken: (token) => tokens.revoke(token),
  })
  try {
    const pty = await terminalCli.envForTerminal({ terminalId: 'pty-1', panelId: 'agence-1', cwd: dir, launch: null, executable: '/bin/sh', args: [], env: { PATH: process.env.PATH! } }) as Record<string, string>
    const first = await cliEnv.cliEnv('agence-1')
    const second = await cliEnv.cliEnv('agence-1')
    expect(second.env.CATE_TOKEN).not.toBe(first.env.CATE_TOKEN)
    second.revoke()
    expect(tokens.resolve(first.env.CATE_TOKEN)?.panelId).toBe('agence-1')
    first.revoke()
    expect(tokens.resolve(pty.CATE_TOKEN)?.panelId).toBe('agence-1')
    expect((await run({ ...pty })).token).toBe(pty.CATE_TOKEN)
  } finally { terminalCli.dispose() }
})

it('revokes every outstanding token at dispose', async () => {
  const a = await cliEnv.cliEnv('agence-1')
  const b = await cliEnv.cliEnv('agence-2')
  cliEnv.dispose()
  expect(tokens.resolve(a.env.CATE_TOKEN)).toBeUndefined()
  expect(tokens.resolve(b.env.CATE_TOKEN)).toBeUndefined()
})
