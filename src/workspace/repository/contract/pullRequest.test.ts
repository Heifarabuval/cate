import { describe, expect, it } from 'vitest'
import {
  classifyGhError,
  GhReadError,
  MAX_BODY_CHARS,
  MAX_PATCH_CHARS,
  MAX_PATCHES_CHARS,
  MAX_PR_COMMITS,
  MAX_PR_FILES,
  parsePullRequestFiles,
  parsePullRequestRef,
  parsePullRequestView,
  prChecks,
  prKey,
  prMergeability,
  toGhReadError,
} from './pullRequest'
import checksFixture from './fixtures/pr-checks.json'
import filesFixture from './fixtures/pr-files.json'
import forkFixture from './fixtures/pr-view-fork.json'
import viewFixture from './fixtures/pr-view.json'

// The fixtures are real `gh` answers, e-mails removed and patches cut short.

describe('parsePullRequestRef', () => {
  it.each([
    ['owner/repo#8', { repository: 'owner/repo', number: 8 }],
    ['Owner/Repo#8', { repository: 'owner/repo', number: 8 }],
    ['https://github.com/Owner/Repo/pull/8', { repository: 'owner/repo', number: 8 }],
    ['https://github.com/owner/repo/pull/8/', { repository: 'owner/repo', number: 8 }],
    ['https://github.com/owner/repo/pull/8/files', { repository: 'owner/repo', number: 8 }],
    ['8', { repository: null, number: 8 }],
    ['#8', { repository: null, number: 8 }],
    ['  8  ', { repository: null, number: 8 }],
  ])('reads %s', (value, expected) => {
    expect(parsePullRequestRef(value)).toEqual(expected)
  })

  it.each([
    'abc',
    '',
    '0',
    '-1',
    '1.5',
    'a/b#',
    'a/b/c#1',
    'o/r/pull/8',
    '99999999999999999999',
    'https://github.com.evil.test/o/r/pull/8',
    'https://evil.test/github.com/o/r/pull/8',
    'http://github.com/o/r/pull/8',
    'https://github.com/o/r/issues/8',
  ])('refuses %j', (value) => {
    expect(parsePullRequestRef(value)).toBeNull()
  })
})

describe('prKey', () => {
  it('ignores case and keeps a null repository apart', () => {
    expect(prKey({ repository: 'Owner/Repo', number: 8 })).toBe('owner/repo#8')
    expect(prKey({ repository: 'owner/repo', number: 8 })).toBe(prKey({ repository: 'OWNER/REPO', number: 8 }))
    expect(prKey({ repository: null, number: 8 })).toBe('#8')
  })
})

describe('prChecks', () => {
  const run = (conclusion: string, status = 'COMPLETED') => ({
    __typename: 'CheckRun', name: 'c', status, conclusion, detailsUrl: 'https://github.com/o/r/actions/runs/1',
  })
  const context = (state: string) => ({ __typename: 'StatusContext', context: 'ctx', state, targetUrl: 'https://ci.example.test/1' })

  it('reads a real rollup mixing CheckRun and StatusContext', () => {
    const checks = prChecks(checksFixture.statusCheckRollup)
    expect(checks.state).toBe('failing')
    expect(checks.items.map((i) => [i.name, i.result])).toEqual([
      ['build-tarball', 'passing'],
      ['label-external', 'skipped'],
      ['node-test-commit', 'passing'],
      ['tide', 'pending'],
      ['tide', 'failing'],
    ])
    expect(checks.items[0].url).toBe('https://github.com/nodejs/node/actions/runs/44137035722/job/134229278565')
    expect(checks.items[2].url).toBe('https://ci.nodejs.org/job/node-test-commit/94275/')
  })

  it('is passing when every check succeeded or was skipped', () => {
    expect(prChecks([run('SUCCESS'), context('SUCCESS'), run('SKIPPED')]).state).toBe('passing')
  })

  it('is pending when one is running and none failed', () => {
    expect(prChecks([run('SUCCESS'), run('', 'IN_PROGRESS')]).state).toBe('pending')
    expect(prChecks([run('SUCCESS'), run('', 'QUEUED')]).state).toBe('pending')
    expect(prChecks([context('SUCCESS'), context('PENDING')]).state).toBe('pending')
    expect(prChecks([context('EXPECTED')]).state).toBe('pending')
  })

  it('lets a failure win over a pending check', () => {
    expect(prChecks([run('', 'IN_PROGRESS'), run('FAILURE')]).state).toBe('failing')
    expect(prChecks([run('CANCELLED')]).state).toBe('failing')
    expect(prChecks([run('TIMED_OUT')]).state).toBe('failing')
    expect(prChecks([context('ERROR')]).state).toBe('failing')
    expect(prChecks([context('FAILURE')]).state).toBe('failing')
  })

  it('is none without checks, with only skipped ones, or with garbage', () => {
    expect(prChecks([])).toEqual({ state: 'none', items: [] })
    expect(prChecks([run('SKIPPED'), run('NEUTRAL')]).state).toBe('none')
    expect(prChecks(null)).toEqual({ state: 'none', items: [] })
    expect(prChecks([null, 3, 'x', {}])).toEqual({ state: 'none', items: [] })
  })

  it('keeps a missing link as null and refuses a non-https one', () => {
    expect(prChecks([{ __typename: 'StatusContext', context: 'x', state: 'SUCCESS' }]).items[0].url).toBeNull()
    expect(prChecks([{ __typename: 'StatusContext', context: 'x', state: 'SUCCESS', targetUrl: 'javascript:alert(1)' }]).items[0].url).toBeNull()
  })
})

describe('prMergeability', () => {
  it.each([
    ['OPEN', 'MERGEABLE', 'CLEAN', 'mergeable'],
    ['OPEN', 'MERGEABLE', 'UNSTABLE', 'mergeable'],
    ['OPEN', 'MERGEABLE', 'HAS_HOOKS', 'mergeable'],
    ['OPEN', 'MERGEABLE', 'BLOCKED', 'blocked'],
    ['OPEN', 'MERGEABLE', 'BEHIND', 'blocked'],
    ['OPEN', 'CONFLICTING', 'DIRTY', 'conflict'],
    ['OPEN', 'UNKNOWN', 'UNKNOWN', 'computing'],
    ['MERGED', 'UNKNOWN', 'UNKNOWN', null],
    ['CLOSED', 'MERGEABLE', 'CLEAN', null],
    ['merged', 'MERGEABLE', 'CLEAN', null],
  ])('%s %s %s gives %s', (state, mergeable, status, expected) => {
    expect(prMergeability(state, mergeable, status)).toBe(expected)
  })
})

describe('parsePullRequestFiles', () => {
  const parsed = parsePullRequestFiles(filesFixture, 'heifarabuval/cate', 13)

  it('maps every status and diff kind of a real answer', () => {
    expect(parsed.files.map((f) => [f.status, f.diff])).toEqual([
      ['modified', 'patch'],
      ['added', 'patch'],
      ['renamed', 'patch'],
      ['deleted', 'patch'],
      ['added', 'binary'],
      ['added', 'too-large'],
    ])
    expect(parsed.files[2]).toMatchObject({
      path: '.github/skills/code-review/SKILL.md',
      oldPath: '.github/skills/cli-code-reviewer/SKILL.md',
      additions: 1,
      deletions: 1,
    })
    expect(parsed.files[0].oldPath).toBeUndefined()
    expect(parsed.files[0].webUrl).toBe(filesFixture[0].blob_url)
  })

  it('keeps patches only for files that have one', () => {
    expect(Object.keys(parsed.patches)).toEqual([
      'docs/architecture.md',
      'src/client/host/openBeside.test.ts',
      '.github/skills/code-review/SKILL.md',
      'types/three/test/unit/examples/jsm/postprocessing/EffectComposer.ts',
    ])
    expect(parsed.patches['docs/architecture.md']).toBe(filesFixture[0].patch)
  })

  it('marks a rename without change as none', () => {
    const { files } = parsePullRequestFiles(
      [{ filename: 'b.ts', previous_filename: 'a.ts', status: 'renamed', additions: 0, deletions: 0, changes: 0, blob_url: 'https://github.com/o/r/blob/x/b.ts' }],
      'o/r',
      1,
    )
    expect(files[0]).toMatchObject({ status: 'renamed', oldPath: 'a.ts', diff: 'none' })
  })

  it('treats copied, changed and unchanged as modified', () => {
    const entry = (status: string) => ({ filename: `${status}.ts`, status, additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+x' })
    const { files } = parsePullRequestFiles(['copied', 'changed', 'unchanged'].map(entry), 'o/r', 1)
    expect(files.map((f) => f.status)).toEqual(['modified', 'modified', 'modified'])
  })

  it('falls back to the pull request files page for a missing or foreign link', () => {
    const row = { status: 'added', additions: 1, deletions: 0, patch: '+x' }
    const { files } = parsePullRequestFiles(
      [
        { ...row, filename: 'a' },
        { ...row, filename: 'b', blob_url: 'javascript:alert(1)' },
        { ...row, filename: 'c', blob_url: 'https://evil.test/o/r/blob/x/c' },
      ],
      'o/r',
      8,
    )
    expect(files.map((f) => f.webUrl)).toEqual(Array(3).fill('https://github.com/o/r/pull/8/files'))
  })

  it('refuses a patch over the per-file cap and stops storing past the total cap', () => {
    const file = (name: string, size: number) => ({ filename: name, status: 'modified', additions: 1, deletions: 0, patch: 'x'.repeat(size) })
    const huge = parsePullRequestFiles([file('big', MAX_PATCH_CHARS + 1), file('ok', MAX_PATCH_CHARS)], 'o/r', 1)
    expect(huge.files.map((f) => f.diff)).toEqual(['too-large', 'patch'])
    expect(Object.keys(huge.patches)).toEqual(['ok'])

    const many = parsePullRequestFiles(
      Array.from({ length: MAX_PATCHES_CHARS / MAX_PATCH_CHARS + 2 }, (_, i) => file(`f${i}`, MAX_PATCH_CHARS)),
      'o/r',
      1,
    )
    const stored = Object.values(many.patches).reduce((sum, p) => sum + p.length, 0)
    expect(stored).toBeLessThanOrEqual(MAX_PATCHES_CHARS)
    expect(many.files.at(0)?.diff).toBe('patch')
    expect(many.files.at(-1)?.diff).toBe('too-large')
  })

  it('reads at most MAX_PR_FILES files', () => {
    const rows = Array.from({ length: MAX_PR_FILES + 1 }, (_, i) => ({ filename: `f${i}`, status: 'added', additions: 1, deletions: 0, patch: '+x' }))
    expect(parsePullRequestFiles(rows, 'o/r', 1).files).toHaveLength(MAX_PR_FILES)
  })

  it('survives a hostile file name and skips malformed rows', () => {
    const out = parsePullRequestFiles(
      [{ filename: '__proto__', status: 'added', additions: 1, deletions: 0, patch: '+x' }, null, { status: 'added' }, 7],
      'o/r',
      1,
    )
    expect(out.files.map((f) => f.path)).toEqual(['__proto__'])
    expect(Object.keys(out.patches)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).patch).toBeUndefined()
  })

  it('throws on something that is not a list', () => {
    expect(() => parsePullRequestFiles({ message: 'Not Found' }, 'o/r', 1)).toThrow('Unexpected GitHub response')
    expect(() => parsePullRequestFiles({ message: 'Not Found' }, 'o/r', 1)).toThrow(GhReadError)
  })
})

describe('parsePullRequestView', () => {
  const files = parsePullRequestFiles(filesFixture, 'heifarabuval/cate', 13).files

  it('reads a real merged pull request of the fork', () => {
    const details = parsePullRequestView(viewFixture, files)
    expect(details).toMatchObject({
      repository: 'heifarabuval/cate',
      number: 13,
      url: 'https://github.com/Heifarabuval/cate/pull/13',
      title: 'feat(agents): add --model and --effort to cate agent start',
      author: 'Heifarabuval',
      state: 'merged',
      draft: false,
      head: 'feat/agent-model-effort',
      base: 'main',
      commitCount: 4,
      commitsTruncated: false,
      fileCount: 18,
      filesTruncated: true,
      additions: 273,
      deletions: 21,
      checks: { state: 'none', items: [] },
      mergeability: null,
    })
    expect(details.commits[0]).toEqual({
      oid: '8a0b8504618e9cc67f99ce155ff0b083c6425d56',
      title: 'feat(agents): add --model and --effort to cate agent start',
      author: 'Heifarabuval',
      date: '2026-11-17T19:19:14Z',
    })
    expect(details.files).toBe(files)
  })

  it('reads a draft from a fork with owner:branch, first commit author and mixed check results', () => {
    const details = parsePullRequestView(forkFixture, files.slice(0, 4))
    expect(details).toMatchObject({
      repository: 'cli/cli',
      state: 'open',
      draft: true,
      head: 'mrecachinas:release-download-verify',
      base: 'trunk',
      mergeability: 'blocked',
      fileCount: 4,
      filesTruncated: false,
      checks: { state: 'passing' },
    })
    expect(details.commits[0].author).toBe('mrecachinas')
  })

  it('flags 250 commits as truncated and never reads more', () => {
    const commits = (n: number) => Array.from({ length: n }, () => viewFixture.commits[0])
    expect(parsePullRequestView({ ...viewFixture, commits: commits(MAX_PR_COMMITS - 1) }, files)).toMatchObject({
      commitsTruncated: false,
      commitCount: MAX_PR_COMMITS - 1,
    })
    const full = parsePullRequestView({ ...viewFixture, commits: commits(MAX_PR_COMMITS + 20) }, files)
    expect(full.commitsTruncated).toBe(true)
    expect(full.commits).toHaveLength(MAX_PR_COMMITS)
  })

  it('flags fewer files read than changedFiles as truncated', () => {
    expect(parsePullRequestView({ ...viewFixture, changedFiles: files.length }, files).filesTruncated).toBe(false)
    expect(parsePullRequestView({ ...viewFixture, changedFiles: files.length + 1 }, files).filesTruncated).toBe(true)
  })

  it('caps the description, drops e-mails, names a deleted author and a deleted fork', () => {
    const withEmail = { ...viewFixture.commits[0], authors: [{ email: 'a@b.test', login: 'a', name: 'A' }] }
    const details = parsePullRequestView(
      { ...viewFixture, body: 'x'.repeat(MAX_BODY_CHARS * 2), author: null, isCrossRepository: true, headRepositoryOwner: null, commits: [withEmail] },
      files,
    )
    expect(details.body).toHaveLength(MAX_BODY_CHARS)
    expect(details.author).toBe('Deleted account')
    expect(details.head).toBe('ghost:feat/agent-model-effort')
    expect(JSON.stringify(details)).not.toContain('a@b.test')
  })

  it('throws on something that is not a pull request', () => {
    expect(() => parsePullRequestView(null, [])).toThrow(GhReadError)
    expect(() => parsePullRequestView(null, [])).toThrow('Unexpected GitHub response')
    expect(() => parsePullRequestView({ ...viewFixture, state: 'WEIRD' }, [])).toThrow('Unexpected GitHub response')
    expect(() => parsePullRequestView({ ...viewFixture, url: 'https://example.test/x' }, [])).toThrow('Unexpected GitHub response')
  })
})

describe('classifyGhError', () => {
  const failure = (stderr: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`Command failed: gh\n${stderr}`), { stderr, code: 1 }, extra)

  it.each([
    [Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), 'missing-cli'],
    [failure('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.'), 'signed-out'],
    [failure('HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login'), 'signed-out'],
    [failure('GraphQL: Could not resolve to a PullRequest with the number of 99999. (repository.pullRequest)'), 'not-found'],
    [failure('gh: Not Found (HTTP 404)'), 'not-found'],
    [failure("GraphQL: Could not resolve to a Repository with the name 'o/nope'. (repository)"), 'repo-unreadable'],
    [failure('HTTP 403: Resource protected by organization SAML enforcement'), 'repo-unreadable'],
    [failure('gh: API rate limit exceeded for user ID 1. (HTTP 403)'), 'rate-limited'],
    [failure('You have exceeded a secondary rate limit. (HTTP 403)'), 'rate-limited'],
    [failure('HTTP 429: Too Many Requests'), 'rate-limited'],
    [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), 'offline'],
    [failure('error connecting to api.github.com\ncheck your internet connection'), 'offline'],
    [failure('dial tcp: lookup api.github.com: no such host ENOTFOUND'), 'offline'],
    [failure('', { killed: true, signal: 'SIGTERM', code: null }), 'offline'],
    [failure('something nobody planned for'), 'error'],
    ['a string', 'error'],
    [null, 'error'],
    [undefined, 'error'],
  ])('classifies %#', (error, kind) => {
    expect(classifyGhError(error)).toBe(kind)
  })
})

describe('toGhReadError', () => {
  it('wraps a gh failure into a typed error without the raw stderr', () => {
    const raw = Object.assign(new Error('Command failed: gh pr view'), { stderr: 'HTTP 401: Bad credentials ghp_secret', code: 1 })
    const typed = toGhReadError(raw)
    expect(typed).toBeInstanceOf(GhReadError)
    expect(typed.kind).toBe('signed-out')
    expect(typed.message).toBe('Sign in to GitHub to read pull requests.')
    expect(typed.message).not.toContain('ghp_secret')
  })

  it('gives a size message when gh output overflowed the buffer', () => {
    const raw = Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
    expect(toGhReadError(raw)).toMatchObject({ kind: 'error', message: 'Pull request too large to list, see GitHub' })
  })

  it('keeps an already typed error and types an unknown throw', () => {
    const typed = new GhReadError('rate-limited')
    expect(toGhReadError(typed)).toBe(typed)
    expect(toGhReadError('boom')).toMatchObject({ kind: 'error' })
  })
})
