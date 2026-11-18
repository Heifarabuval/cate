import os from 'node:os'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn(), env: {} as NodeJS.ProcessEnv }))
vi.mock('node:child_process', () => ({ execFile: mocks.exec, spawn: mocks.spawn }))

import { createGithubHost } from './github'
import { GhReadError, githubRepository, githubRepositoryUrl, parsePullRequests } from '../contract'

const host = () => createGithubHost({ env: () => mocks.env })

const pr = { id: 'PR_1', number: 42, title: 'Fix startup', url: 'https://github.com/org/repo/pull/42', updatedAt: '2026-09-08T10:00:00Z', additions: 20, deletions: 3, isDraft: false, repository: { nameWithOwner: 'org/repo' }, author: null, commits: { nodes: [] } }
const payload = { data: { viewer: { login: 'alice' }, authored: { nodes: [pr], pageInfo: { hasNextPage: false } }, review: { nodes: [pr], pageInfo: { hasNextPage: true } } } }

beforeEach(() => {
  mocks.exec.mockReset()
  mocks.spawn.mockReset()
  mocks.env = { PATH: '/test/bin' }
})

it('deduplicates groups, handles deleted authors and missing checks, and reports pagination', () => {
  const result = parsePullRequests(payload)
  expect(result).toMatchObject({ status: 'ready', account: 'alice', truncated: true, items: [{ id: 'PR_1', author: 'Deleted account', checks: null, involvement: 'authored' }] })
  if (result.status === 'ready') expect(result.items).toHaveLength(1)
})

it('rejects partial GraphQL results instead of presenting incomplete totals', () => {
  expect(() => parsePullRequests({ ...payload, errors: [{ message: 'Rate limited' }] })).toThrow('full pull request list')
})

it('reports missing gh without attempting authentication or API calls', async () => {
  mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(new Error('ENOENT')))
  expect(await host().pullRequests(true)).toMatchObject({ status: 'missing-cli' })
  expect(mocks.exec).toHaveBeenCalledTimes(1)
})

it('reports signed-out accounts without fetching pull requests', async () => {
  mocks.exec.mockImplementation((_cmd, args, _opts, callback) => args[0] === '--version' ? callback(null, 'gh 2.96', '') : callback(new Error('Not logged in')))
  expect(await host().pullRequests(true)).toMatchObject({ status: 'signed-out' })
  expect(mocks.exec).toHaveBeenCalledTimes(2)
})

function fakeLogin() {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { write: vi.fn() }), kill: vi.fn() })
  mocks.spawn.mockReturnValue(child)
  return child
}

it('exposes only the device code and advances the browser flow once', () => {
  const gh = host()
  const child = fakeLogin()
  expect(gh.startLogin(1)).toEqual({ status: 'pending' })
  child.stderr.emit('data', Buffer.from('First copy your one-time code: ABCD-'))
  child.stderr.emit('data', Buffer.from('1234\n'))
  expect(gh.loginState(1)).toEqual({ status: 'pending', code: 'ABCD-1234' })
  child.stderr.emit('data', Buffer.from('Press Enter to open github.com'))
  expect(child.stdin.write).toHaveBeenCalledExactlyOnceWith('\n')
  child.emit('close', 0)
  expect(gh.loginState(1)).toEqual({ status: 'complete' })
  gh.cancelLogin(1)
})

it('cancels only the requesting connection login', () => {
  const gh = host()
  const child = fakeLogin()
  gh.startLogin(2)
  expect(gh.loginState(3)).toEqual({ status: 'idle' })
  gh.cancelLogin(3)
  expect(child.kill).not.toHaveBeenCalled()
  gh.cancelLogin(2)
  expect(child.kill).toHaveBeenCalledOnce()
  expect(gh.loginState(2)).toEqual({ status: 'idle' })
})

it('recognizes GitHub remotes without accepting lookalike hosts', () => {
  for (const remote of ['git@github.com:Org/Repo.git', 'https://github.com/Org/Repo.git', 'ssh://git@github.com/Org/Repo']) expect(githubRepository(remote)).toBe('org/repo')
  expect(githubRepository('https://github.com.evil.test/org/repo')).toBeNull()
})

it.each(['git@github.com:org/repo.git', 'ssh://git@github.com/org/repo.git', 'https://github.com/org/repo.git', 'https://token@github.com/org/repo'])('creates a credential-free GitHub link for %s', (remote) => {
  expect(githubRepositoryUrl(remote)).toBe('https://github.com/org/repo')
})

it.each(['https://github.com.evil.com/org/repo', 'javascript:alert(1)', '/local/repo', 'https://github.com/org/repo?token=secret'])('does not turn %s into a GitHub link', (remote) => {
  expect(githubRepositoryUrl(remote)).toBeNull()
})

it('reports account and version independently of the pull request API', async () => {
  mocks.exec.mockImplementation((_cmd, args, _opts, callback) => callback(null, { stdout: args[0] === '--version' ? 'gh version 2.96.0\nrelease notes' : args[0] === 'api' ? 'alice\n' : '' }))
  expect(await host().connection()).toEqual({ status: 'connected', version: 'gh version 2.96.0', account: 'alice' })
  expect(mocks.exec.mock.calls.some((call) => call[1].includes('graphql'))).toBe(false)
})

it('does not fetch or check out a PR in a different repository', async () => {
  mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(null, { stdout: 'git@github.com:other/repo.git' }))
  expect(await host().pullRequestContext('/project', 'org/repo', 42)).toBeNull()
  expect(mocks.exec).toHaveBeenCalledTimes(1)
})

it('fetches the PR base without changing the current branch', async () => {
  const baseOid = 'a'.repeat(40)
  mocks.exec.mockImplementation((cmd, args, _opts, callback) => callback(null, { stdout: cmd === 'gh' ? JSON.stringify({ headRefName: 'feature', baseRefOid: baseOid }) : args[0] === 'remote' ? 'https://github.com/org/repo.git' : '' }))
  expect(await host().pullRequestContext('/project', 'org/repo', 42)).toEqual({ headRefName: 'feature', baseOid })
  expect(mocks.exec.mock.calls.map((call) => call[1])).toEqual([
    ['remote', 'get-url', 'origin'], ['pr', 'view', '42', '--repo', 'github.com/org/repo', '--json', 'headRefName,baseRefOid'], ['fetch', 'origin', baseOid],
  ])
})

it('forces github.com on every gh command the host can start', async () => {
  const baseOid = 'a'.repeat(40)
  mocks.exec.mockImplementation((cmd, args: string[], _opts, callback) => {
    const out = cmd === 'git' ? 'https://github.com/org/repo.git'
      : args[0] === '--version' ? 'gh version 2.96.0'
      : args.includes('graphql') ? JSON.stringify(payload)
      : args.includes('--jq') ? 'alice'
      : args.includes('headRefName,baseRefOid') ? JSON.stringify({ headRefName: 'feature', baseRefOid: baseOid })
      : args.includes('--paginate') ? '[]'
      : args[0] === 'pr' ? '{}'
      : 'token'
    callback(null, { stdout: out })
  })
  const gh = host()
  fakeLogin()
  await gh.connection()
  await gh.pullRequests(true)
  await gh.token()
  await gh.pullRequestContext('/project', 'org/repo', 42)
  await gh.pullRequestView('org/repo', 42)
  await gh.pullRequestChecks('org/repo', 42)
  await gh.pullRequestFiles('org/repo', 42)
  gh.startLogin(1)
  gh.cancelLogin(1)
  const sent: string[][] = [
    ...mocks.exec.mock.calls.filter((call) => call[0] === 'gh').map((call) => call[1] as string[]),
    ...mocks.spawn.mock.calls.filter((call) => call[0] === 'gh').map((call) => call[1] as string[]),
  ]
  expect(sent.length).toBeGreaterThanOrEqual(12)
  // `gh --version` never reaches GitHub: every other command names the host.
  const unpinned = sent.filter((args) => args[0] !== '--version' && !(args.includes('--hostname') && args[args.indexOf('--hostname') + 1] === 'github.com')
    && !args.some((arg, i) => args[i - 1] === '--repo' && arg.startsWith('github.com/')))
  expect(unpinned).toEqual([])
})

it('reads the active github.com account token and follows account changes', async () => {
  mocks.exec.mockImplementationOnce((_cmd, _args, _opts, callback) => callback(null, { stdout: 'first-token\n' }))
    .mockImplementationOnce((_cmd, _args, _opts, callback) => callback(null, { stdout: 'second-token\n' }))
  const gh = host()
  expect(await gh.token()).toBe('first-token')
  expect(await gh.token()).toBe('second-token')
  expect(mocks.exec).toHaveBeenCalledWith('gh', ['auth', 'token', '--hostname', 'github.com'],
    expect.objectContaining({ cwd: os.homedir(), env: mocks.env, timeout: 30_000 }), expect.any(Function))
})

it('matches GitHub CLI environment token precedence', async () => {
  mocks.env.GH_TOKEN = 'gh-token'
  mocks.env.GITHUB_TOKEN = 'github-token'
  expect(await host().token()).toBe('gh-token')
  delete mocks.env.GH_TOKEN
  expect(await host().token()).toBe('github-token')
  expect(mocks.exec).not.toHaveBeenCalled()
})

it.each(['ENOENT', 'not logged in'])('allows anonymous requests when gh reports %s', async (message) => {
  mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(new Error(message)))
  expect(await host().token()).toBeUndefined()
})

const VIEW_FIELDS = 'number,url,title,author,body,state,isDraft,headRefName,baseRefName,isCrossRepository,headRepositoryOwner,commits,changedFiles,additions,deletions,statusCheckRollup,mergeable,mergeStateStatus'
const reads = [
  ['pullRequestView', ['pr', 'view', '42', '--repo', 'github.com/org/repo', '--json', VIEW_FIELDS], 4 * 1024 * 1024, 30_000, '{"number":42}', { number: 42 }],
  ['pullRequestChecks', ['pr', 'view', '42', '--repo', 'github.com/org/repo', '--json', 'state,isDraft,statusCheckRollup,mergeable,mergeStateStatus'], 4 * 1024 * 1024, 30_000, '{"state":"OPEN"}', { state: 'OPEN' }],
  ['pullRequestFiles', ['api', '--hostname', 'github.com', '--method', 'GET', '--paginate', 'repos/org/repo/pulls/42/files?per_page=100'], 32 * 1024 * 1024, 60_000, '[{"filename":"a"}]', [{ filename: 'a' }]],
] as const

describe.each(reads)('%s', (method, args, maxBuffer, timeout, stdout, parsed) => {
  it('runs the exact read-only gh call from the home directory with a named timeout and buffer', async () => {
    mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(null, { stdout }))
    expect(await host()[method]('org/repo', 42)).toEqual(parsed)
    expect(mocks.exec).toHaveBeenCalledExactlyOnceWith('gh', args,
      expect.objectContaining({ cwd: os.homedir(), env: mocks.env, timeout, maxBuffer, windowsHide: true }), expect.any(Function))
  })

  it('passes no write argument', async () => {
    mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(null, { stdout }))
    await host()[method]('org/repo', 42)
    const sent: string[] = mocks.exec.mock.calls[0][1]
    expect(sent.join(' ')).not.toMatch(/(^| )(merge|review|comment|close|edit|reopen|ready|lock|checkout|create|delete)( |$)|-X|--input|(^| )-[fF]( |$)|--(raw-)?field/)
    if (sent[0] === 'api') expect(sent.slice(sent.indexOf('--method'), sent.indexOf('--method') + 2)).toEqual(['--method', 'GET'])
    else expect(sent.slice(0, 2)).toEqual(['pr', 'view'])
  })

  it.each(['org', 'a/b/c', 'a b/c', '/repo', 'org/', '', 'org/repo; rm -rf', '../..', '..', '.', './.', 'org/..', '../repo', '-x/-y', 'org/-y', '-x/repo', '.org/repo', `${'a'.repeat(40)}/repo`, `org/${'r'.repeat(101)}`, 'org/repo\n'])('refuses the repository %j without calling gh', async (repository) => {
    await expect(host()[method](repository, 42)).rejects.toBeInstanceOf(GhReadError)
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('refuses the number %s without calling gh', async (number) => {
    await expect(host()[method]('org/repo', number)).rejects.toBeInstanceOf(GhReadError)
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it.each([
    [Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), 'missing-cli'],
    [Object.assign(new Error('failed'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login' }), 'signed-out'],
    [Object.assign(new Error('failed'), { stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 42. (repository.pullRequest)' }), 'not-found'],
    [Object.assign(new Error('failed'), { stderr: 'gh: API rate limit exceeded (HTTP 403)' }), 'rate-limited'],
    [Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), 'offline'],
  ])('rejects a gh failure as a typed error %#', async (failure, kind) => {
    mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(failure))
    const error = await host()[method]('org/repo', 42).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GhReadError)
    expect(error).toMatchObject({ kind })
    expect(error).not.toBe(failure)
  })

  it('says the pull request is too large when the output overflows the buffer', async () => {
    const overflow = Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
    mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(overflow))
    await expect(host()[method]('org/repo', 42)).rejects.toMatchObject({ kind: 'error', message: 'Pull request too large to list, see GitHub' })
  })

  it('rejects an answer that is not JSON as a typed error', async () => {
    mocks.exec.mockImplementation((_cmd, _args, _opts, callback) => callback(null, { stdout: '<html>' }))
    await expect(host()[method]('org/repo', 42)).rejects.toBeInstanceOf(GhReadError)
  })
})

/** gh that never answers, like execFile it fails once its signal aborts. */
function hangingGh() {
  mocks.exec.mockImplementation((_cmd, _args, opts: { signal?: AbortSignal }, callback) => {
    opts.signal?.addEventListener('abort', () => callback(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })))
  })
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

it('hands the caller signal to gh, and an abort frees the slot for the next read', async () => {
  hangingGh()
  const gh = host()
  const closing = new AbortController()
  const held = [1, 2, 3].map((n) => gh.pullRequestFiles('org/repo', n, closing.signal).catch((e: unknown) => e))
  const next = gh.pullRequestView('org/repo', 4)
  await settle()
  expect(mocks.exec).toHaveBeenCalledTimes(3)
  expect(mocks.exec.mock.calls[0][2]).toMatchObject({ signal: closing.signal })

  closing.abort()
  await settle()

  for (const failure of await Promise.all(held)) expect(failure).toBeInstanceOf(GhReadError)
  expect(mocks.exec).toHaveBeenCalledTimes(4)
  expect(mocks.exec.mock.calls[3][1].slice(0, 3)).toEqual(['pr', 'view', '4'])
  void next.catch(() => {})
})

it('never runs gh for a read aborted while it waits for a slot, or aborted before it asks', async () => {
  hangingGh()
  const gh = host()
  const others = new AbortController()
  const held = [1, 2, 3].map((n) => gh.pullRequestView('org/repo', n, others.signal).catch(() => {}))
  const closing = new AbortController()
  const waiting = gh.pullRequestView('org/repo', 4, closing.signal)
  await settle()

  closing.abort()
  await expect(waiting).rejects.toBeInstanceOf(GhReadError)
  await expect(gh.pullRequestChecks('org/repo', 5, AbortSignal.abort())).rejects.toBeInstanceOf(GhReadError)
  others.abort()
  await Promise.all(held)
  await settle()

  expect(mocks.exec).toHaveBeenCalledTimes(3)
})

it('never runs more than 3 gh calls at once, resolves all 16 and survives failures', async () => {
  const held: Array<() => void> = []
  let active = 0
  let peak = 0
  mocks.exec.mockImplementation((_cmd, args, _opts, callback) => {
    active += 1
    peak = Math.max(peak, active)
    held.push(() => {
      active -= 1
      if (args[args.indexOf('--paginate') + 1]?.includes('/pulls/3/')) callback(new Error('failed'))
      else callback(null, { stdout: '[]' })
    })
  })
  const gh = host()
  const calls = Array.from({ length: 16 }, (_, i) => gh.pullRequestFiles('org/repo', i + 1).then(() => 'ok', () => 'failed'))
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  await flush()
  expect(held).toHaveLength(3)
  while (held.length) {
    held.shift()?.()
    await flush()
  }
  expect(await Promise.all(calls)).toEqual(Array.from({ length: 16 }, (_, i) => (i === 2 ? 'failed' : 'ok')))
  expect(mocks.exec).toHaveBeenCalledTimes(16)
  expect(peak).toBeLessThanOrEqual(3)
})
