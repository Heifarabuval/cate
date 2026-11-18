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
    ['remote', 'get-url', 'origin'], ['pr', 'view', '42', '--repo', 'org/repo', '--json', 'headRefName,baseRefOid'], ['fetch', 'origin', baseOid],
  ])
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
  ['pullRequestView', ['pr', 'view', '42', '--repo', 'org/repo', '--json', VIEW_FIELDS], 4 * 1024 * 1024, 30_000, '{"number":42}', { number: 42 }],
  ['pullRequestChecks', ['pr', 'view', '42', '--repo', 'org/repo', '--json', 'state,isDraft,statusCheckRollup,mergeable,mergeStateStatus'], 4 * 1024 * 1024, 30_000, '{"state":"OPEN"}', { state: 'OPEN' }],
  ['pullRequestFiles', ['api', '--method', 'GET', '--paginate', 'repos/org/repo/pulls/42/files?per_page=100'], 32 * 1024 * 1024, 60_000, '[{"filename":"a"}]', [{ filename: 'a' }]],
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

  it.each(['org', 'a/b/c', 'a b/c', '/repo', 'org/', '', 'org/repo; rm -rf'])('refuses the repository %j without calling gh', async (repository) => {
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
