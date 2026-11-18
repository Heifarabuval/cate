import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createLogger } from '@kernel/log/contract'
import { RpcError } from '@kernel/rpc/contract'
import { MAIN_WINDOW, type Json, type PanelRecord } from '@workspace/document/contract'
import { createDocumentService, type DocumentService } from '@workspace/document/runtime'
import { GhReadError, type RepoStatus } from '@workspace/repository/contract'
import { createGithubHost } from '@workspace/repository/runtime'
import type { AgentChangeRecord } from '@services/agents/contract'
import type { SessionKit, SessionStore } from '@panels/framework/runtime'
import type { ReviewOp, ReviewSnapshot, ReviewState } from './contract'
import { ReviewSession, type ReviewGithub, type ReviewSessionDeps } from './session'

const file = { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, binary: false, staged: false, working: true }
const diff = {
  path: 'src/a.ts', binary: false, tooLarge: false, byteLength: 1, patch: 'PATCH',
  hunks: [{ header: '@@', oldStart: 1, oldLines: 1, newStart: 4, newLines: 1, lines: [{ kind: 'add' as const, text: 'return safe()', oldLine: null, newLine: 4 }] }],
}
const repoStatus = (files: string[]): RepoStatus => ({
  isRepo: true, branch: 'main', dirty: true, tracking: null, ahead: 0, behind: 0,
  files: files.map((p) => ({ path: p, index: ' ', working_dir: 'M' })), branches: [], worktrees: [],
})

let dir: string
let document: DocumentService
let stored: Json | undefined
let statusListeners: Array<(status: RepoStatus) => void>
let changeListeners: Array<(cwd: string) => void>
let records: AgentChangeRecord[]
let deps: ReviewSessionDeps
let repo: Record<string, ReturnType<typeof vi.fn>>
let session: ReviewSession

const snap = () => session.snapshot() as unknown as ReviewSnapshot
const saved = () => stored as unknown as ReviewState
const op = (value: ReviewOp) => session.handleOp(value, { clientId: 'c', connectionId: 1 })

function makeSession(record: PanelRecord): ReviewSession {
  const store: SessionStore = { read: () => stored, write: (value) => { stored = value }, flush: async () => {} }
  const kit: SessionKit = {
    panelId: record.id, document, store, log: createLogger('test'),
    surface: async () => undefined,
  }
  return new ReviewSession(kit, record, deps)
}

async function start(fields: Record<string, Json> = { repoPath: '/repo' }): Promise<void> {
  const record: PanelRecord = { id: 'review', type: 'review', title: 'Review', fields }
  if (!document.get().panels.review) {
    document.apply({ kind: 'addPanel', record, at: { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's1' } })
  }
  session = makeSession(document.get().panels.review)
  await session.start()
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-session-'))
  document = createDocumentService({ file: path.join(dir, 'document.json'), debounceMs: 60_000 })
  stored = undefined
  statusListeners = []
  changeListeners = []
  records = []
  repo = {
    compare: vi.fn(async () => ({ spec: { kind: 'uncommitted' }, files: [file], additions: 1, deletions: 0, currentBranch: 'feature' })),
    fileDiff: vi.fn(async () => diff),
    fileContent: vi.fn(async ({ side }: { side: string }) => ({ exists: true, size: 1, base64: side })),
    stage: vi.fn(async () => {}),
    unstage: vi.fn(async () => {}),
    discardFile: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    log: vi.fn(async () => []),
    branchList: vi.fn(async () => ({ current: 'main', branches: [] })),
    readStatus: vi.fn(async () => ({ files: [], current: 'main', tracking: null, ahead: 0, behind: 0 })),
    createPr: vi.fn(async () => ({ ok: true, created: true, url: 'https://example.test/pr/1' })),
    refreshStatus: vi.fn(),
  }
  deps = {
    root: '/repo',
    repository: {
      ...(repo as unknown as ReviewSessionDeps['repository']),
      watchStatus: (_cwd, listener) => {
        statusListeners.push(listener)
        return () => { statusListeners = statusListeners.filter((l) => l !== listener) }
      },
    },
    agents: {
      cachedChanges: vi.fn(() => undefined),
      readChanges: vi.fn(async () => ({ revision: String(records.length), records })),
      readiness: vi.fn(async () => [{ agentId: 'codex' as const, ready: true }]),
      start: vi.fn(async () => ({ panelId: 'worker' })),
      onChanges: (listener) => {
        changeListeners.push(listener)
        return () => { changeListeners = changeListeners.filter((l) => l !== listener) }
      },
    },
  }
  await start()
  for (const listener of statusListeners) listener(repoStatus([]))
  await vi.waitFor(() => expect(snap().recorded.loading).toBe(false))
})

afterEach(() => {
  session.dispose('shutdown')
  document.dispose()
  rmSync(dir, { recursive: true, force: true })
})




it('merges an open request, keeping local state, and reveals its file once', async () => {
  expect(snap().reveal).toBeNull()
  await op({ kind: 'retarget', request: { agentChanges: { agentId: 'codex' }, focusedFile: 'src/a.ts' } })
  expect(saved()).toMatchObject({ agentChanges: { agentId: 'codex' } })
  expect(saved()).not.toHaveProperty('focusedFile')
  const reveal = snap().reveal
  expect(reveal).toMatchObject({ path: 'src/a.ts' })
  await op({ kind: 'retarget', request: { agentChanges: { agentId: 'codex' }, focusedFile: 'src/a.ts' } })
  expect(snap().reveal!.seq).toBeGreaterThan(reveal!.seq)
})

it('switches worktrees by id and follows the checkout in the record', async () => {
  document.apply({ kind: 'setWorktree', worktree: { id: 'main', path: '/repo', color: 'green', status: 'ready' } })
  document.apply({ kind: 'setWorktree', worktree: { id: 'feature', path: '/feature', color: 'blue', status: 'ready' } })
  await op({ kind: 'updateFilter', patch: { sessionId: 'main-session' } })
  await op({ kind: 'switchWorktree', worktreeId: 'feature' })
  expect(saved().repoPath).toBe('/feature')
  expect(saved().agentChanges).toEqual({})
  expect(document.get().panels.review).toMatchObject({ worktreeId: 'feature', fields: { repoPath: '/feature' } })
  await op({ kind: 'switchWorktree', worktreeId: null })
  expect(saved().repoPath).toBe('/repo')
  expect(saved().agentChanges?.sessionId).toBe('main-session')
})




it('defaults new Reviews to agent edits and returns bounded diff pages without a full patch', async () => {
  session.dispose('shutdown')
  stored = undefined
  document.apply({ kind: 'updatePanel', id: 'review', patch: { fields: { request: null } } })
  await start({ repoPath: '/repo' })
  expect(snap().review.agentChanges).toEqual({})
  records = [{ id: 'long', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['closed'], panelTitles: { closed: 'Implement login' }, cwd: '/repo', createdAt: '1', files: [{
    path: 'src/a.ts', patch: 'FULL PATCH MUST NOT TRAVEL', additions: 1000, deletions: 0, coverage: 'patch',
    hunks: [{ ...diff.hunks[0], lines: Array.from({ length: 1000 }, (_, index) => ({ kind: 'add', text: `line ${index + 1}`, oldLine: null, newLine: index + 1 })) }],
  }] }]
  for (const listener of statusListeners) listener(repoStatus(['src/a.ts']))
  await vi.waitFor(() => expect(snap().recorded.files).toHaveLength(1))
  const page = await op({ kind: 'recordedDiff', recordId: 'long', path: 'src/a.ts', page: 2 }) as { page: number; pageCount: number; patch?: string; hunks: typeof diff.hunks }
  expect(page).toMatchObject({ page: 2, pageCount: 5, totalLines: 1000 })
  expect(page.hunks.flatMap((hunk) => hunk.lines)).toHaveLength(200)
  expect(page.hunks[0].lines[0].newLine).toBe(401)
  expect(page.patch).toBeUndefined()
  await op({ kind: 'updateFilter', patch: { agentId: 'claude-code' } })
  expect(snap().recorded.files).toHaveLength(0)
  expect(snap().recorded.panels).toEqual([{ id: 'closed', title: 'Implement login', agentIds: ['codex'] }])
})

it('chooses the most active recorded agent and retains sources across all filters', async () => {
  session.dispose('shutdown')
  stored = undefined
  document.apply({ kind: 'updatePanel', id: 'review', patch: { fields: { request: null } } })
  const record = (id: string, agentId: AgentChangeRecord['agentId'], panel: string, paths: string[]): AgentChangeRecord => ({
    id, agentId, sessionId: id, turnId: 't', panelIds: [panel], panelTitles: { [panel]: `Task ${panel}` }, cwd: '/repo', createdAt: id,
    files: paths.map((path) => ({ path, uncommitted: agentId !== 'grok', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' })),
  })
  records = [record('1', 'claude-code', 'shared', ['c.ts']), record('2', 'codex', 'shared', ['a.ts', 'b.ts']), record('3', 'grok', 'old', ['old1', 'old2', 'old3'])]
  await start({ repoPath: '/repo' })
  for (const listener of statusListeners) listener(repoStatus(['a.ts', 'b.ts', 'c.ts']))
  await vi.waitFor(() => expect(snap().review.agentChanges?.agentId).toBe('codex'))
  expect(snap().recorded.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts'])
  expect(snap().recorded.agents).toContainEqual({ agentId: 'grok', edits: 3, uncommittedEdits: 0 })
  expect(snap().recorded.panels?.find((source) => source.id === 'shared')?.agentIds).toEqual(['claude-code', 'codex'])
  await op({ kind: 'updateFilter', patch: { agentId: 'grok', panelId: 'old' } })
  expect(snap().recorded.files.map((file) => file.path)).toEqual(['old1', 'old2', 'old3'])
  expect(snap().recorded.panels).toHaveLength(2)
  await op({ kind: 'retarget', request: { agentChanges: { panelId: 'old' } } })
  expect(snap().review.agentChanges?.agentId).toBe('grok')
})

it('does not accept the old Git panel operations', async () => {
  for (const kind of ['stage', 'unstage', 'discard', 'commit', 'createPullRequest', 'applyCommand', 'diff', 'images', 'selectComparison', 'setSpec', 'update']) {
    await expect(op({ kind } as ReviewOp)).rejects.toThrow()
  }
  expect(repo.compare).not.toHaveBeenCalled()
  expect(repo.commit).not.toHaveBeenCalled()
})

it('retains saved edits in a clean checkout and groups summaries by commit', async () => {
  const commit = { hash: 'abc', message: 'Implement login', date: '2026-11-13' }
  const base = { agentId: 'codex' as const, sessionId: 's', turnId: 't', panelIds: [], cwd: '/repo', createdAt: '1' }
  const file = { path: 'src/a.ts', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' as const }
  records = [
    { ...base, id: 'committed', files: [{ ...file, commit }] },
    { ...base, id: 'pending', files: [{ ...file, uncommitted: true }] },
    { ...base, id: 'older', files: [file] },
    { ...base, id: 'same-commit', files: [{ ...file, commit }] },
  ]
  await op({ kind: 'refresh' })
  expect(snap().recorded.files.map((file) => file.recordId)).toEqual(['pending', 'committed', 'same-commit', 'older'])
  expect(snap().recorded.files[1].commit).toEqual(commit)
  expect(snap().review).not.toHaveProperty('showHistory')
})

it('restores recorded edits from a clean checkout regardless of a saved Active preference', async () => {
  session.dispose('shutdown')
  stored = { repoPath: '/repo', spec: { kind: 'uncommitted' }, showHistory: false, agentChanges: { agentId: 'codex' }, notes: [] }
  records = [{ id: 'saved', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['closed'], cwd: '/repo', createdAt: '1', files: [{ path: 'src/a.ts', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' }] }]
  await start()
  for (const listener of statusListeners) listener(repoStatus([]))
  await vi.waitFor(() => expect(snap().recorded.files).toHaveLength(1))
  expect(snap().review).not.toHaveProperty('showHistory')
  expect(snap().review).not.toHaveProperty('spec')
})


it('updates recorded edits when a hook arrives without any Git status change', async () => {
  records = [{ id: 'hook', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['term'], cwd: '/repo', createdAt: '1', files: [{ path: 'src/a.ts', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' }] }]
  for (const listener of changeListeners) listener('/repo')
  await vi.waitFor(() => expect(snap().recorded.files.map((file) => file.recordId)).toEqual(['hook']))
  session.dispose('shutdown')
  expect(changeListeners).toHaveLength(0)
})

it('starts a terminal review with the selected edits and no Review CLI dependency', async () => {
  records = [{ id: 'hook', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['term'], cwd: '/repo', createdAt: '1', files: [{ path: 'src/a.ts', patch: '+safe', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' }] }]
  await op({ kind: 'refresh' })
  expect(await op({ kind: 'reviewWithAgent', agentId: 'codex' })).toBe(true)
  expect(deps.agents.start).toHaveBeenCalledWith('review', expect.objectContaining({ prompt: expect.stringContaining('+safe') }))
  expect(vi.mocked(deps.agents.start).mock.calls[0][1].prompt).not.toContain('cate review note')
  expect(snap().review).not.toHaveProperty('agentReview')
})

it('does not wait for Git status before showing recorded edits', async () => {
  session.dispose('shutdown')
  vi.mocked(deps.agents.readChanges).mockImplementation(async (_cwd, revision) => revision ? { revision } : { revision: 'empty', records: [] })
  await start()
  await vi.waitFor(() => expect(snap().recorded.loading).toBe(false))
})

it('refuses an oversized reviewer prompt without starting a partial review', async () => {
  records = [{ id: 'large', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['term'], cwd: '/repo', createdAt: '1', files: [{ path: 'large.ts', patch: 'x'.repeat(120001), hunks: [], additions: 1, deletions: 0, coverage: 'patch' }] }]
  await op({ kind: 'refresh' })
  expect(await op({ kind: 'reviewWithAgent', agentId: 'codex' })).toBe(false)
  expect(deps.agents.start).not.toHaveBeenCalled()
  expect(snap().error).toContain('too large for one review')
})

it('shows cached records immediately while Git attribution refresh is pending', async () => {
  session.dispose('shutdown')
  const cached: AgentChangeRecord[] = [{ id: 'warm', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['term'], cwd: '/repo', createdAt: '1', files: [{ path: 'src/a.ts', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' }] }]
  vi.mocked(deps.agents.cachedChanges).mockReturnValue({ revision: 'cached', records: cached })
  vi.mocked(deps.agents.readChanges).mockReturnValue(new Promise(() => {}))
  await start()
  expect(snap().recorded.loading).toBe(false)
  expect(snap().recorded.files.map((file) => file.recordId)).toEqual(['warm'])
})

it('shows a cold disk snapshot before Git attribution finishes', async () => {
  session.dispose('shutdown')
  vi.mocked(deps.agents.readChanges).mockReturnValue(new Promise(() => {}))
  await start()
  expect(snap().recorded.loading).toBe(true)
  const cached: AgentChangeRecord[] = [{ id: 'disk', agentId: 'codex', sessionId: 's', turnId: 't', panelIds: ['term'], cwd: '/repo', createdAt: '1', files: [{ path: 'src/a.ts', hunks: diff.hunks, additions: 1, deletions: 0, coverage: 'patch' }] }]
  vi.mocked(deps.agents.cachedChanges).mockReturnValue({ revision: 'disk', records: cached })
  for (const listener of changeListeners) listener('/repo')
  expect(snap().recorded.loading).toBe(false)
  expect(snap().recorded.files.map((file) => file.recordId)).toEqual(['disk'])
})

// ---- Pull request subject ------------------------------------------------------

const T0 = Date.parse('2026-11-18T10:00:00Z')
const run = (conclusion: string) => ({ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion, detailsUrl: 'https://github.com/org/repo/actions/runs/1' })
const viewJson = () => ({
  number: 8, url: 'https://github.com/org/repo/pull/8', title: 'Fix login', author: { login: 'ana' }, body: 'Body',
  state: 'OPEN', isDraft: false, headRefName: 'fix', baseRefName: 'main', isCrossRepository: false,
  commits: [{ oid: 'abcdef1', messageHeadline: 'fix', authors: [{ login: 'ana' }], committedDate: '2026-11-17T09:00:00Z' }],
  changedFiles: 2, additions: 452, deletions: 0, statusCheckRollup: [run('SUCCESS')], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
})
const checksJson = (conclusion: string) => ({ state: 'OPEN', isDraft: false, statusCheckRollup: [run(conclusion)], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' })
const longPatch = ['@@ -0,0 +1,450 @@', ...Array.from({ length: 450 }, (_, index) => `+line ${index + 1}`)].join('\n')
const filesJson = () => [
  { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 0, patch: '@@ -1,1 +1,3 @@\n a\n+b\n+c' },
  { filename: 'src/long.ts', status: 'added', additions: 450, deletions: 0, patch: longPatch },
]

function fakeGithub() {
  return {
    originRepository: vi.fn<ReviewGithub['originRepository']>(async () => 'org/repo'),
    pullRequestView: vi.fn<ReviewGithub['pullRequestView']>(async () => viewJson()),
    pullRequestChecks: vi.fn<ReviewGithub['pullRequestChecks']>(async () => checksJson('SUCCESS')),
    pullRequestFiles: vi.fn<ReviewGithub['pullRequestFiles']>(async () => filesJson()),
  }
}

let prSessions: ReviewSession[] = []
let prWrites: Json[] = []

async function startPr(github: ReviewGithub, pr: { repository: string | null; number: number } = { repository: 'org/repo', number: 8 }, id = 'pr'): Promise<ReviewSession> {
  const record: PanelRecord = { id, type: 'review', title: 'PR #8', fields: { repoPath: '', pr } }
  document.apply({ kind: 'addPanel', record, at: { to: 'stack', dock: { windowId: MAIN_WINDOW }, stackId: 's1' } })
  const store: SessionStore = { read: () => undefined, write: (value) => { prWrites.push(value) }, flush: async () => {} }
  const kit: SessionKit = { panelId: id, document, store, log: createLogger('test'), surface: async () => undefined }
  const created = new ReviewSession(kit, document.get().panels[id], { ...deps, github })
  prSessions.push(created)
  await created.start()
  return created
}

const lastPr = () => prSessions[prSessions.length - 1]
const prSnap = () => (lastPr().snapshot() as unknown as ReviewSnapshot).pr!
const prOp = (value: ReviewOp) => lastPr().handleOp(value, { clientId: 'c', connectionId: 1 })
const loaded = () => vi.waitFor(() => { expect(prSnap().loading).toBe(false); expect(prSnap().data).not.toBeNull() })
const ghCalls = (github: ReturnType<typeof fakeGithub>) =>
  github.pullRequestView.mock.calls.length + github.pullRequestChecks.mock.calls.length + github.pullRequestFiles.mock.calls.length

afterEach(() => {
  for (const created of prSessions) created.dispose('shutdown')
  prSessions = []
  prWrites = []
  vi.useRealTimers()
})

it('reads the pull request when the panel starts, and leaves agent edits alone', async () => {
  vi.mocked(deps.agents.readChanges).mockClear()
  vi.mocked(deps.agents.readiness).mockClear()
  const listeners = [statusListeners.length, changeListeners.length]
  const github = fakeGithub()

  await startPr(github)
  await loaded()

  expect(prSnap()).toMatchObject({
    ref: { repository: 'org/repo', number: 8 }, error: null,
    data: { title: 'Fix login', author: 'ana', state: 'open', head: 'fix', base: 'main', checks: { state: 'passing' }, mergeability: 'mergeable' },
  })
  expect(prSnap().data!.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/long.ts'])
  expect(typeof prSnap().readAt).toBe('string')
  expect(github.pullRequestView).toHaveBeenCalledWith('org/repo', 8)
  expect(github.pullRequestFiles).toHaveBeenCalledWith('org/repo', 8)
  expect(github.originRepository).not.toHaveBeenCalled()
  expect(deps.agents.readChanges).not.toHaveBeenCalled()
  expect(deps.agents.readiness).not.toHaveBeenCalled()
  expect([statusListeners.length, changeListeners.length]).toEqual(listeners)
})

it('resolves the workspace origin for a bare number and records it in the panel', async () => {
  const github = fakeGithub()

  await startPr(github, { repository: null, number: 8 })
  await loaded()

  expect(github.pullRequestView).toHaveBeenCalledWith('org/repo', 8)
  expect(document.get().panels.pr.fields.pr).toEqual({ repository: 'org/repo', number: 8 })
  expect(prSnap().ref).toEqual({ repository: 'org/repo', number: 8 })
})

it('says no-origin for a bare number without a GitHub origin, and runs no gh read', async () => {
  const github = fakeGithub()
  github.originRepository.mockResolvedValue(null)

  await startPr(github, { repository: null, number: 8 })
  await vi.waitFor(() => expect(prSnap().error?.kind).toBe('no-origin'))

  expect(prSnap()).toMatchObject({ loading: false, data: null, ref: null })
  expect(prSnap().error!.message).toContain('owner/repo#N')
  expect(ghCalls(github)).toBe(0)
})

it('says untrusted, with the way out, when the workspace is not trusted', async () => {
  const github = fakeGithub()
  github.pullRequestView.mockRejectedValue(new RpcError('untrusted', 'This workspace is not trusted'))

  await startPr(github)
  await vi.waitFor(() => expect(prSnap().error?.kind).toBe('untrusted'))

  expect(prSnap().error!.message).toBe('Trust this workspace to read GitHub')
  expect(prSnap().data).toBeNull()
})

it('says untrusted when the origin cannot be read either', async () => {
  const github = fakeGithub()
  github.originRepository.mockRejectedValue(new RpcError('untrusted', 'This workspace is not trusted'))

  await startPr(github, { repository: null, number: 8 })
  await vi.waitFor(() => expect(prSnap().error?.kind).toBe('untrusted'))

  expect(ghCalls(github)).toBe(0)
})

it.each([
  [new GhReadError('signed-out'), 'signed-out'],
  [Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), 'missing-cli'],
])('classifies a first read that fails (%s) as %s, with no data', async (failure, kind) => {
  const github = fakeGithub()
  github.pullRequestView.mockRejectedValue(failure)

  await startPr(github)
  await vi.waitFor(() => expect(prSnap().error?.kind).toBe(kind))

  expect(prSnap()).toMatchObject({ loading: false, data: null, readAt: null })
})

it('serves a bounded page of a file patch, and keeps patches out of the snapshot', async () => {
  const github = fakeGithub()
  await startPr(github)
  await loaded()

  const page = await prOp({ kind: 'prFileDiff', path: 'src/long.ts', page: 1 }) as { hunks: Array<{ lines: Array<{ newLine: number | null }> }> }

  expect(page).toMatchObject({ path: 'src/long.ts', diff: 'patch', page: 1, pageCount: 3, totalLines: 450 })
  expect(page.hunks.flatMap((hunk) => hunk.lines)).toHaveLength(200)
  expect(page.hunks[0].lines[0].newLine).toBe(201)
  expect(JSON.stringify(lastPr().snapshot())).not.toContain('line 450')
  await expect(prOp({ kind: 'prFileDiff', path: 'nope.ts' })).rejects.toMatchObject({ code: 'rejected', message: 'pr-file-not-found' })
  expect(github.pullRequestFiles).toHaveBeenCalledTimes(1)
})

it('re-reads the checks at most once per 25 seconds, and only the checks', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  const github = fakeGithub()
  github.pullRequestChecks.mockResolvedValue(checksJson('FAILURE'))
  await startPr(github)
  await loaded()

  expect(await prOp({ kind: 'prTick' })).toBe(false)
  vi.setSystemTime(T0 + 24_000)
  expect(await prOp({ kind: 'prTick' })).toBe(false)
  expect(github.pullRequestChecks).not.toHaveBeenCalled()

  vi.setSystemTime(T0 + 25_000)
  expect(await prOp({ kind: 'prTick' })).toBe(true)
  expect(await prOp({ kind: 'prTick' })).toBe(false)

  expect(github.pullRequestChecks).toHaveBeenCalledTimes(1)
  expect(github.pullRequestChecks).toHaveBeenCalledWith('org/repo', 8)
  expect(github.pullRequestView).toHaveBeenCalledTimes(1)
  expect(github.pullRequestFiles).toHaveBeenCalledTimes(1)
  expect(prSnap()).toMatchObject({
    data: { checks: { state: 'failing' } },
    readAt: new Date(T0).toISOString(),
    checksReadAt: new Date(T0 + 25_000).toISOString(),
  })
})

it('ignores a tick that arrives while a read is running', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  const github = fakeGithub()
  let release!: (value: unknown) => void
  github.pullRequestChecks.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  await startPr(github)
  await loaded()
  vi.setSystemTime(T0 + 60_000)

  const first = prOp({ kind: 'prTick' })
  await vi.waitFor(() => expect(github.pullRequestChecks).toHaveBeenCalledTimes(1))
  expect(await prOp({ kind: 'prTick' })).toBe(false)
  release(checksJson('FAILURE'))

  expect(await first).toBe(true)
  expect(github.pullRequestChecks).toHaveBeenCalledTimes(1)
})

it('refresh re-reads everything, whatever the 25 second threshold', async () => {
  const github = fakeGithub()
  await startPr(github)
  await loaded()

  await prOp({ kind: 'refresh' })

  await vi.waitFor(() => expect(github.pullRequestView).toHaveBeenCalledTimes(2))
  expect(github.pullRequestFiles).toHaveBeenCalledTimes(2)
})

it('keeps the last data and read time when a later read fails', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  const github = fakeGithub()
  await startPr(github)
  await loaded()
  const before = prSnap()
  vi.setSystemTime(T0 + 60_000)
  github.pullRequestView.mockRejectedValueOnce(new GhReadError('offline'))

  await prOp({ kind: 'refresh' })
  await vi.waitFor(() => expect(prSnap().error?.kind).toBe('offline'))

  expect(prSnap()).toMatchObject({ loading: false, readAt: before.readAt, checksReadAt: before.checksReadAt })
  expect(prSnap().data).toEqual(before.data)
  await prOp({ kind: 'refresh' })
  await vi.waitFor(() => expect(prSnap().error).toBeNull())
  expect(prSnap().readAt).toBe(new Date(T0 + 60_000).toISOString())
})

it.skipIf(process.platform === 'win32')('16 panels reading at once never run more than 3 gh calls', async () => {
  const bin = path.join(dir, 'bin')
  const active = path.join(dir, 'active')
  const log = path.join(dir, 'concurrency.log')
  mkdirSync(bin)
  mkdirSync(active)
  writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs')
const mark = ${JSON.stringify(active)} + '/' + process.pid
fs.writeFileSync(mark, '')
fs.appendFileSync(${JSON.stringify(log)}, fs.readdirSync(${JSON.stringify(active)}).length + '\\n')
setTimeout(() => {
  fs.rmSync(mark)
  process.stdout.write(JSON.stringify(process.argv[2] === 'api' ? [] : ${JSON.stringify(viewJson())}))
}, 60)
`)
  chmodSync(path.join(bin, 'gh'), 0o755)
  const host = createGithubHost({ env: () => ({ ...process.env, PATH: bin }) })
  const github: ReviewGithub = {
    originRepository: async () => 'org/repo',
    pullRequestView: (repository, number) => host.pullRequestView(repository, number),
    pullRequestChecks: (repository, number) => host.pullRequestChecks(repository, number),
    pullRequestFiles: (repository, number) => host.pullRequestFiles(repository, number),
  }

  await expect(host.pullRequestView('org/repo', 8)).resolves.toMatchObject({ number: 8 })
  await expect(host.pullRequestFiles('org/repo', 8)).resolves.toEqual([])
  writeFileSync(log, '')

  for (let index = 0; index < 16; index++) await startPr(github, { repository: 'org/repo', number: 8 }, `pr${index}`)
  await vi.waitFor(() => expect(prSessions.every((s) => (s.snapshot() as unknown as ReviewSnapshot).pr?.data)).toBe(true), { timeout: 10_000 })
  host.dispose()

  const running = readFileSync(log, 'utf8').trim().split('\n').map(Number)
  expect(running.length).toBeGreaterThanOrEqual(32)
  expect(Math.max(...running)).toBeLessThanOrEqual(3)
  expect(Math.max(...running)).toBeGreaterThanOrEqual(2)
}, 15_000)

it('refuses agent ops on a pull request panel, and pull request ops on an agent panel', async () => {
  await startPr(fakeGithub())
  const agentOps: ReviewOp[] = [
    { kind: 'updateFilter', patch: {} },
    { kind: 'recordedDiff', recordId: 'r', path: 'a' },
    { kind: 'switchCheckout', path: '/x' },
    { kind: 'switchWorktree', worktreeId: null },
    { kind: 'retarget', request: {} },
    { kind: 'reviewAgents' },
    { kind: 'reviewWithAgent', agentId: 'codex' },
  ]

  for (const agentOp of agentOps) await expect(prOp(agentOp)).rejects.toMatchObject({ code: 'rejected', message: 'pr-subject' })
  await expect(op({ kind: 'prTick' })).rejects.toMatchObject({ code: 'rejected', message: 'agent-subject' })
  await expect(op({ kind: 'prFileDiff', path: 'a' })).rejects.toMatchObject({ code: 'rejected', message: 'agent-subject' })
})

it('disposes without a gh call, and writes nothing to its session file', async () => {
  const github = fakeGithub()
  await startPr(github)
  await loaded()
  await prOp({ kind: 'refresh' })
  await vi.waitFor(() => expect(github.pullRequestView).toHaveBeenCalledTimes(2))
  const calls = ghCalls(github)

  lastPr().dispose('shutdown')

  expect(ghCalls(github)).toBe(calls)
  expect(prWrites).toEqual([])
})
