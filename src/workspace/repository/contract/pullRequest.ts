// A pull request read through `gh`: the data model and the pure functions that
// turn `gh pr view --json` and the REST `pulls/<n>/files` list into it. The
// runtime does the reading (`runtime/github.ts`); nothing here touches I/O.

export interface PullRequestRef {
  /** `owner/name` lowercased; null until the workspace origin is resolved. */
  repository: string | null
  number: number
}

export interface PullRequestCommit {
  oid: string
  title: string
  author: string
  date: string
}

export interface PullRequestFile {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  /** `none`: renamed without change. `binary` and `too-large`: GitHub sent no patch. */
  diff: 'patch' | 'binary' | 'too-large' | 'none'
  /** "Open on GitHub". */
  webUrl: string
}

export interface PullRequestCheck {
  name: string
  result: 'passing' | 'pending' | 'failing' | 'skipped'
  url: string | null
}

export type PullRequestChecks = { state: 'passing' | 'pending' | 'failing' | 'none'; items: PullRequestCheck[] }
export type PullRequestMergeability = 'mergeable' | 'conflict' | 'blocked' | 'computing'

export interface PullRequestDetails {
  repository: string
  number: number
  url: string
  title: string
  author: string
  body: string
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  /** `branch`, or `owner:branch` for a fork. */
  head: string
  base: string
  commits: PullRequestCommit[]
  commitCount: number
  commitsTruncated: boolean
  files: PullRequestFile[]
  fileCount: number
  filesTruncated: boolean
  additions: number
  deletions: number
  checks: PullRequestChecks
  /** null: closed or merged. */
  mergeability: PullRequestMergeability | null
}

/** GitHub's own ceilings (250 commits, 3000 files) and ours, so nothing read from a pull request is unbounded. */
export const MAX_PR_COMMITS = 250
export const MAX_PR_FILES = 3000
export const MAX_PR_CHECKS = 300
export const MAX_BODY_CHARS = 100_000
/** A longer patch is not kept: the file is `too-large` and read on GitHub. */
export const MAX_PATCH_CHARS = 250_000
/** All kept patches of one pull request together. */
export const MAX_PATCHES_CHARS = 8_000_000

const UNEXPECTED = 'Unexpected GitHub response'
// GitHub's own limits: an owner has 39 characters at most, a repository 100; both start with a letter or a digit,
// which also rules out `.`, `..` and a leading `-` (an option for gh).
const REPO = '[A-Za-z0-9][A-Za-z0-9._-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}'
const REPO_NAME = new RegExp(`^${REPO}$`)

/** `owner/name` as GitHub spells it; the only form allowed to reach a `gh` command line. */
export function isRepositoryName(value: string): boolean {
  return REPO_NAME.test(value)
}

const SHORT_REF = new RegExp(`^(${REPO})#(\\d+)$`)
const URL_REF = new RegExp(`^https://github\\.com/(${REPO})/pull/(\\d+)(?:/files)?/?$`)

function ref(repository: string | null, digits: string): PullRequestRef | null {
  const number = Number(digits)
  return Number.isSafeInteger(number) && number > 0 ? { repository: repository?.toLowerCase() ?? null, number } : null
}

/** `owner/repo#8`, a github.com pull request URL, `#8` or `8`; null for anything else. */
export function parsePullRequestRef(value: string): PullRequestRef | null {
  const trimmed = value.trim()
  const named = trimmed.match(SHORT_REF) ?? trimmed.match(URL_REF)
  if (named) return ref(named[1], named[2])
  const bare = trimmed.match(/^#?(\d+)$/)
  return bare ? ref(null, bare[1]) : null
}

export function prKey(pr: PullRequestRef): string {
  return `${pr.repository?.toLowerCase() ?? ''}#${pr.number}`
}

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const httpsUrl = (value: unknown): string | null => (typeof value === 'string' && value.startsWith('https://') ? value : null)

const RUN_FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

function checkOf(row: unknown): PullRequestCheck | null {
  if (!isRow(row)) return null
  if (row.__typename === 'StatusContext') {
    const state = str(row.state)
    const result = state === 'SUCCESS' ? 'passing' : state === 'FAILURE' || state === 'ERROR' ? 'failing' : 'pending'
    return { name: str(row.context), result, url: httpsUrl(row.targetUrl) }
  }
  if (row.__typename === 'CheckRun') {
    const conclusion = str(row.conclusion)
    const result = row.status !== 'COMPLETED' ? 'pending'
      : conclusion === 'SUCCESS' ? 'passing'
      : conclusion === 'SKIPPED' || conclusion === 'NEUTRAL' ? 'skipped'
      : RUN_FAILED.has(conclusion) ? 'failing'
      : 'pending'
    return { name: str(row.name), result, url: httpsUrl(row.detailsUrl) }
  }
  return null
}

/** Overall state of a `statusCheckRollup` (CheckRun and StatusContext mixed). Skipped checks count for nothing. */
export function prChecks(rollup: unknown): PullRequestChecks {
  const all = (Array.isArray(rollup) ? rollup : []).map(checkOf).filter((c): c is PullRequestCheck => c !== null)
  const has = (result: PullRequestCheck['result']) => all.some((c) => c.result === result)
  const state = has('failing') ? 'failing' : has('pending') ? 'pending' : has('passing') ? 'passing' : 'none'
  return { state, items: all.slice(0, MAX_PR_CHECKS) }
}

export function prMergeability(state: string, mergeable: string, mergeStateStatus: string): PullRequestMergeability | null {
  if (state.toUpperCase() !== 'OPEN') return null
  if (mergeable === 'CONFLICTING') return 'conflict'
  if (mergeable === 'UNKNOWN') return 'computing'
  return mergeStateStatus === 'BLOCKED' || mergeStateStatus === 'BEHIND' ? 'blocked' : 'mergeable'
}

const FILE_STATUS: Record<string, PullRequestFile['status']> = { added: 'added', removed: 'deleted', renamed: 'renamed' }

/** The REST `pulls/<n>/files` list: the files and, apart, the patches kept in memory. */
export function parsePullRequestFiles(
  json: unknown,
  repository: string,
  number: number,
): { files: PullRequestFile[]; patches: Record<string, string> } {
  if (!Array.isArray(json)) throw new GhReadError('error', UNEXPECTED)
  const files: PullRequestFile[] = []
  const patches: Array<[string, string]> = []
  let kept = 0
  for (const row of json) {
    if (files.length === MAX_PR_FILES) break
    if (!isRow(row) || typeof row.filename !== 'string' || row.filename === '') continue
    const status = FILE_STATUS[str(row.status)] ?? 'modified'
    const additions = num(row.additions)
    const deletions = num(row.deletions)
    const patch = str(row.patch)
    const changed = additions + deletions
    let diff: PullRequestFile['diff']
    if (patch !== '') {
      diff = patch.length > MAX_PATCH_CHARS || kept + patch.length > MAX_PATCHES_CHARS ? 'too-large' : 'patch'
      if (diff === 'patch') {
        patches.push([row.filename, patch])
        kept += patch.length
      }
    } else if (changed > 0) diff = 'too-large'
    // ponytail: an empty added file also reads as binary; "Open on GitHub" shows it
    else diff = status === 'renamed' ? 'none' : 'binary'
    const blob = str(row.blob_url)
    files.push({
      path: row.filename,
      ...(typeof row.previous_filename === 'string' ? { oldPath: row.previous_filename } : {}),
      status,
      additions,
      deletions,
      diff,
      webUrl: blob.startsWith('https://github.com/') ? blob : `https://github.com/${repository}/pull/${number}/files`,
    })
  }
  return { files, patches: Object.fromEntries(patches) }
}

const PR_STATE: Record<string, PullRequestDetails['state']> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }

function commitOf(row: unknown): PullRequestCommit {
  const commit = isRow(row) ? row : {}
  const first = Array.isArray(commit.authors) && isRow(commit.authors[0]) ? commit.authors[0] : {}
  return {
    oid: str(commit.oid),
    title: str(commit.messageHeadline),
    author: str(first.login) || str(first.name),
    date: str(commit.committedDate) || str(commit.authoredDate),
  }
}

/** `gh pr view --json ...` plus the files already read. Throws on a shape that is not a pull request. */
export function parsePullRequestView(json: unknown, files: PullRequestFile[]): PullRequestDetails {
  if (!isRow(json)) throw new GhReadError('error', UNEXPECTED)
  const url = str(json.url)
  const where = parsePullRequestRef(url)
  const state = PR_STATE[str(json.state)]
  if (!where?.repository || !state) throw new GhReadError('error', UNEXPECTED)
  const author = isRow(json.author) ? str(json.author.login) : ''
  const owner = isRow(json.headRepositoryOwner) ? str(json.headRepositoryOwner.login) : ''
  const branch = str(json.headRefName)
  const rawCommits = Array.isArray(json.commits) ? json.commits : []
  const commits = rawCommits.slice(0, MAX_PR_COMMITS).map(commitOf)
  const fileCount = num(json.changedFiles)
  return {
    repository: where.repository,
    number: where.number,
    url,
    title: str(json.title),
    author: author || 'Deleted account',
    body: str(json.body).slice(0, MAX_BODY_CHARS),
    state,
    draft: json.isDraft === true,
    head: json.isCrossRepository === true ? `${owner || 'ghost'}:${branch}` : branch,
    base: str(json.baseRefName),
    commits,
    commitCount: commits.length,
    // gh does not report the total: 250 is GitHub's own ceiling, so a full page may be cut
    commitsTruncated: rawCommits.length >= MAX_PR_COMMITS,
    files,
    fileCount,
    filesTruncated: files.length < fileCount,
    additions: num(json.additions),
    deletions: num(json.deletions),
    checks: prChecks(json.statusCheckRollup),
    mergeability: prMergeability(str(json.state), str(json.mergeable), str(json.mergeStateStatus)),
  }
}

export type PullRequestErrorKind = 'missing-cli' | 'signed-out' | 'not-found' | 'repo-unreadable' | 'rate-limited' | 'offline' | 'error'

const NETWORK = /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|error connecting to|no such host/i
const MAX_BUFFER = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

/** Sorts an `execFile` failure of `gh` into what the user can act on. */
export function classifyGhError(error: unknown): PullRequestErrorKind {
  if (!isRow(error)) return 'error'
  if (error.code === 'ENOENT') return 'missing-cli'
  if (error.code === MAX_BUFFER) return 'error'
  const output = `${str(error.stderr)}\n${str(error.message)}`
  if (/gh auth login|HTTP 401|bad credentials|not logged in/i.test(output)) return 'signed-out'
  if (/rate limit|HTTP 429/i.test(output)) return 'rate-limited'
  if (/could not resolve to a repository|HTTP 403/i.test(output)) return 'repo-unreadable'
  if (/could not resolve to a pullrequest|HTTP 404|not found/i.test(output)) return 'not-found'
  if (NETWORK.test(`${str(error.code)}\n${output}`) || error.killed === true) return 'offline'
  return 'error'
}

const GH_MESSAGES: Record<PullRequestErrorKind, string> = {
  'missing-cli': 'Install GitHub CLI to read pull requests.',
  'signed-out': 'Sign in to GitHub to read pull requests.',
  'not-found': 'Pull request not found.',
  'repo-unreadable': 'Repository not found, or not readable with this GitHub account.',
  'rate-limited': 'GitHub rate limit reached. Try again later.',
  offline: 'Could not reach GitHub. Check your connection.',
  error: 'Could not read the pull request from GitHub.',
}

/** What a `gh` read rejects with: a kind to branch on and a message safe to show (never the raw stderr). */
export class GhReadError extends Error {
  readonly kind: PullRequestErrorKind

  constructor(kind: PullRequestErrorKind, message: string = GH_MESSAGES[kind]) {
    super(message)
    this.name = 'GhReadError'
    this.kind = kind
  }
}

export function toGhReadError(error: unknown): GhReadError {
  if (error instanceof GhReadError) return error
  if (isRow(error) && error.code === MAX_BUFFER) return new GhReadError('error', 'Pull request too large to list, see GitHub')
  return new GhReadError(classifyGhError(error))
}
