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
export const MAX_BODY_CHARS = 20_000
/** Text written by a third party is cleaned and cut to these lengths (the last character of a cut text is an ellipsis). */
export const MAX_TITLE_CHARS = 300
export const MAX_PATH_CHARS = 1024
export const MAX_NAME_CHARS = 100
export const MAX_REF_CHARS = 255
export const MAX_URL_CHARS = 2048
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

// ANSI escapes (CSI, OSC, two-character ones), then what cannot be shown: C0 and C1 controls, bidi overrides and
// isolates, zero-width marks, the line and paragraph separators. line() and block() deal with tab and line breaks first.
// Built from strings: written as literals, U+2028 and U+2029 would end the regex.
const ANSI = new RegExp('\\u001b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?|[@-Z\\\\-_])', 'g')
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u0084\\u0086-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]',
  'g',
)

function bound(value: string, max: number): string {
  if (value.length <= max) return value
  let end = max - 1
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1 // not half of an emoji
  return `${value.slice(0, end)}…`
}

/** One line of text from GitHub: any run of white space becomes one space, invisible characters go, the length is bounded. */
const line = (value: unknown, max: number): string =>
  bound(str(value).replace(ANSI, '').replace(/[\s\u0085]+/g, ' ').replace(INVISIBLE, ''), max)

/** Like `line`, but line breaks and tabs stay (a description). */
const block = (value: unknown, max: number): string =>
  bound(str(value).replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\u0085/g, '\n').replace(/\r/g, '').replace(INVISIBLE, ''), max)

const httpsUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= MAX_URL_CHARS && /^https:\/\/[\x21-\x7e]+$/.test(value) ? value : null

const RUN_FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

function checkOf(row: unknown): PullRequestCheck | null {
  if (!isRow(row)) return null
  if (row.__typename === 'StatusContext') {
    const state = str(row.state)
    const result = state === 'SUCCESS' ? 'passing' : state === 'FAILURE' || state === 'ERROR' ? 'failing' : 'pending'
    return { name: line(row.context, MAX_TITLE_CHARS), result, url: httpsUrl(row.targetUrl) }
  }
  if (row.__typename === 'CheckRun') {
    const conclusion = str(row.conclusion)
    const result = row.status !== 'COMPLETED' ? 'pending'
      : conclusion === 'SUCCESS' ? 'passing'
      : conclusion === 'SKIPPED' || conclusion === 'NEUTRAL' ? 'skipped'
      : RUN_FAILED.has(conclusion) ? 'failing'
      : 'pending'
    return { name: line(row.name, MAX_TITLE_CHARS), result, url: httpsUrl(row.detailsUrl) }
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
    if (!isRow(row)) continue
    const path = line(row.filename, MAX_PATH_CHARS)
    if (path === '') continue
    const status = FILE_STATUS[str(row.status)] ?? 'modified'
    const additions = num(row.additions)
    const deletions = num(row.deletions)
    const patch = str(row.patch)
    const changed = additions + deletions
    let diff: PullRequestFile['diff']
    if (patch !== '') {
      diff = patch.length > MAX_PATCH_CHARS || kept + patch.length > MAX_PATCHES_CHARS ? 'too-large' : 'patch'
      if (diff === 'patch') {
        patches.push([path, patch])
        kept += patch.length
      }
    } else if (changed > 0) diff = 'too-large'
    // ponytail: an empty added file also reads as binary; "Open on GitHub" shows it
    else diff = status === 'renamed' ? 'none' : 'binary'
    const blob = httpsUrl(row.blob_url)
    files.push({
      path,
      ...(typeof row.previous_filename === 'string' ? { oldPath: line(row.previous_filename, MAX_PATH_CHARS) } : {}),
      status,
      additions,
      deletions,
      diff,
      webUrl: blob?.startsWith('https://github.com/') ? blob : `https://github.com/${repository}/pull/${number}/files`,
    })
  }
  return { files, patches: Object.fromEntries(patches) }
}

const PR_STATE: Record<string, PullRequestDetails['state']> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }

function commitOf(row: unknown): PullRequestCommit {
  const commit = isRow(row) ? row : {}
  const first = Array.isArray(commit.authors) && isRow(commit.authors[0]) ? commit.authors[0] : {}
  return {
    oid: /^[0-9a-f]{7,64}$/i.test(str(commit.oid)) ? str(commit.oid) : '',
    title: line(commit.messageHeadline, MAX_TITLE_CHARS),
    author: line(first.login, MAX_NAME_CHARS) || line(first.name, MAX_NAME_CHARS),
    date: line(commit.committedDate || commit.authoredDate, 40),
  }
}

/** `gh pr view --json ...` plus the files already read. Throws on a shape that is not a pull request. */
export function parsePullRequestView(json: unknown, files: PullRequestFile[]): PullRequestDetails {
  if (!isRow(json)) throw new GhReadError('error', UNEXPECTED)
  const url = str(json.url)
  const where = parsePullRequestRef(url)
  const state = PR_STATE[str(json.state)]
  if (!where?.repository || !state) throw new GhReadError('error', UNEXPECTED)
  const author = isRow(json.author) ? line(json.author.login, MAX_NAME_CHARS) : ''
  const owner = isRow(json.headRepositoryOwner) ? line(json.headRepositoryOwner.login, MAX_NAME_CHARS) : ''
  const branch = line(json.headRefName, MAX_REF_CHARS)
  const rawCommits = Array.isArray(json.commits) ? json.commits : []
  const commits = rawCommits.slice(0, MAX_PR_COMMITS).map(commitOf)
  const fileCount = num(json.changedFiles)
  return {
    repository: where.repository,
    number: where.number,
    url,
    title: line(json.title, MAX_TITLE_CHARS),
    author: author || 'Deleted account',
    body: block(json.body, MAX_BODY_CHARS),
    state,
    draft: json.isDraft === true,
    head: json.isCrossRepository === true ? `${owner || 'ghost'}:${branch}` : branch,
    base: line(json.baseRefName, MAX_REF_CHARS),
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

/** The light refresh (`gh pr view --json state,isDraft,statusCheckRollup,mergeable,mergeStateStatus`). */
export function parsePullRequestChecks(json: unknown): Pick<PullRequestDetails, 'state' | 'draft' | 'checks' | 'mergeability'> {
  const state = isRow(json) ? PR_STATE[str(json.state)] : undefined
  if (!isRow(json) || !state) throw new GhReadError('error', UNEXPECTED)
  return {
    state,
    draft: json.isDraft === true,
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
