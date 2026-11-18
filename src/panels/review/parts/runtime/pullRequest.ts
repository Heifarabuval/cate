// The pull request subject of a review session: reads one pull request
// through `gh`, publishes what it read, keeps the patches in memory and pages
// them. It never reads on its own: a view's `prTick` or `refresh`, or the
// session start, asks. One read at a time per pull request; the others join
// it, wait for it, or are ignored.

import { isRpcError, RpcError } from '@kernel/rpc/contract'
import {
  diffPage,
  parsePullRequestChecks,
  parsePullRequestFiles,
  parsePullRequestRef,
  parsePullRequestView,
  parseReviewPatch,
  toGhReadError,
  type PullRequestRef,
} from '@workspace/repository/contract'
import { PR_REFRESH_INTERVAL_MS, PR_TICK_INTERVAL_MS, type PrDiffPage, type PrErrorKind, type ReviewPrState } from '../../contract/types'

/** What a pull request panel needs from GitHub: the repository runtime's `github`, which refuses an untrusted
 *  workspace and runs at most 3 `gh` calls at once. Reads answer raw `gh` JSON, parsed by the repository contract. */
export interface ReviewGithub {
  /** An aborted `signal` kills the running `gh` and frees its slot. */
  pullRequestView(repository: string, number: number, signal?: AbortSignal): Promise<unknown>
  /** The light read: state, draft, checks, mergeability. */
  pullRequestChecks(repository: string, number: number, signal?: AbortSignal): Promise<unknown>
  pullRequestFiles(repository: string, number: number, signal?: AbortSignal): Promise<unknown>
  /** `owner/name` of the workspace origin; null without a GitHub origin. */
  originRepository(): Promise<string | null>
}

export interface PullRequestSubjectDeps {
  ref: PullRequestRef
  github: ReviewGithub
  publish(state: ReviewPrState): void
  /** Records that the pull request is in the workspace origin, `repository` (so a bare `N` finds the panel). */
  recordOrigin(repository: string): void
}

export interface PullRequestSubject {
  start(): void
  /** A full read, whatever the threshold; joins a running full read. */
  refresh(): Promise<void>
  /** Re-reads the checks when the last read started 25 s ago or more and none runs. */
  tick(): Promise<boolean>
  fileDiff(path: string, page?: number): PrDiffPage
  dispose(): void
}

/** After consecutive failures the tick waits twice as long each time (25, 50, 100 s...), up to this. */
export const PR_TICK_BACKOFF_MAX_MS = 5 * 60_000
const UNTRUSTED = 'Trust this workspace to read GitHub'
const NO_ORIGIN = 'This workspace has no GitHub origin. Use owner/repo#N.'

export function initialPrState(ref: PullRequestRef): ReviewPrState {
  const resolved = ref.repository ? { repository: ref.repository, number: ref.number } : null
  return { ref: resolved, loading: true, readAt: null, checksReadAt: null, error: null, data: null }
}

type Resolved = { repository: string; number: number }
interface Read { kind: 'full' | 'checks'; done: Promise<void> }

export function createPullRequestSubject(deps: PullRequestSubjectDeps): PullRequestSubject {
  const { github } = deps
  let state = initialPrState(deps.ref)
  let patches = new Map<string, string>()
  let running: Read | null = null
  let lastReadAt = 0
  let lastFullReadAt = 0
  let failures = 0
  let originChecked = false
  let disposed = false
  // Closing the panel kills its running gh (the slot goes to another read) and settles the ops waiting on it,
  // even on a read that cannot be aborted (the origin, a git read).
  const aborts = new AbortController()
  let closed!: () => void
  const whenClosed = new Promise<void>((resolve) => { closed = resolve })

  // After dispose the session publishes nothing (`PanelSession.publish`).
  const set = (patch: Partial<ReviewPrState>) => {
    state = { ...state, ...patch }
    deps.publish(state)
  }

  function succeeded(patch: Partial<ReviewPrState>): void {
    failures = 0
    set({ ...patch, error: null })
  }

  function failed(error: unknown): void {
    failures += 1
    const untrusted = isRpcError(error, 'untrusted')
    const ghError = untrusted ? null : toGhReadError(error)
    const kind: PrErrorKind = ghError?.kind ?? 'untrusted'
    // The data and its read times stay: they say how old what is shown is.
    set({ loading: false, error: { kind, message: ghError?.message ?? UNTRUSTED } })
  }

  const tickInterval = () => Math.min(PR_TICK_INTERVAL_MS * 2 ** Math.max(0, failures - 1), PR_TICK_BACKOFF_MAX_MS)

  /** Runs one read; ops waiting on it settle when the panel closes, whatever `gh` does. */
  function read(kind: Read['kind'], work: () => Promise<void>): Promise<void> {
    lastReadAt = Date.now()
    if (kind === 'full') lastFullReadAt = lastReadAt
    const entry: Read = { kind, done: Promise.resolve() }
    running = entry
    const work$ = (async () => {
      try {
        await work()
      } catch (error) {
        failed(error)
      } finally {
        if (running === entry) running = null
      }
    })()
    entry.done = Promise.race([work$, whenClosed])
    return entry.done
  }

  async function resolveRef(): Promise<Resolved | null> {
    if (state.ref) return state.ref
    const repository = await github.originRepository()
    if (disposed) return null
    const ref = repository ? parsePullRequestRef(`${repository}#${deps.ref.number}`) : null
    if (!ref?.repository) {
      set({ loading: false, error: { kind: 'no-origin', message: NO_ORIGIN } })
      return null
    }
    const resolved = { repository: ref.repository, number: ref.number }
    originChecked = true
    deps.recordOrigin(resolved.repository)
    set({ ref: resolved })
    return resolved
  }

  /** Once per session, after a read: is an explicit `owner/repo#N` in the workspace origin? A git read, not gh. */
  async function checkOrigin(ref: Resolved): Promise<void> {
    originChecked = true
    const origin = await github.originRepository().catch(() => null)
    if (!disposed && origin?.toLowerCase() === ref.repository) deps.recordOrigin(ref.repository)
  }

  async function readAll(): Promise<void> {
    set({ loading: true })
    const ref = await resolveRef()
    if (!ref || disposed) return
    // One gh call at a time per pull request: the files, then the view that needs them.
    const { signal } = aborts
    const listed = parsePullRequestFiles(await github.pullRequestFiles(ref.repository, ref.number, signal), ref.repository, ref.number)
    if (disposed) return
    const data = parsePullRequestView(await github.pullRequestView(ref.repository, ref.number, signal), listed.files)
    if (disposed) return
    patches = new Map(Object.entries(listed.patches))
    const at = new Date().toISOString()
    succeeded({ data, readAt: at, checksReadAt: at, loading: false })
    if (!originChecked) void checkOrigin(ref)
  }

  async function readChecks(ref: Resolved): Promise<void> {
    const checks = parsePullRequestChecks(await github.pullRequestChecks(ref.repository, ref.number, aborts.signal))
    if (disposed || !state.data) return
    succeeded({ data: { ...state.data, ...checks }, checksReadAt: new Date().toISOString() })
  }

  return {
    start() {
      void read('full', readAll)
    },
    async refresh() {
      while (running && !disposed) {
        if (running.kind === 'full') return running.done
        await running.done
      }
      if (disposed || Date.now() - lastFullReadAt < PR_REFRESH_INTERVAL_MS) return
      return read('full', readAll)
    },
    async tick() {
      if (disposed || running || Date.now() - lastReadAt < tickInterval()) return false
      const ref = state.ref
      // Nothing read yet (a failed first read): the tick retries the whole read.
      await (ref && state.data ? read('checks', () => readChecks(ref)) : read('full', readAll))
      return true
    },
    fileDiff(path, page) {
      const file = state.data?.files.find((item) => item.path === path)
      if (!file) throw new RpcError('rejected', 'pr-file-not-found')
      const patch = patches.get(path)
      return {
        path,
        ...(file.oldPath ? { oldPath: file.oldPath } : {}),
        diff: file.diff,
        ...diffPage(patch ? parseReviewPatch(patch) : [], page),
      }
    },
    dispose() {
      disposed = true
      running = null
      aborts.abort()
      closed()
    },
  }
}
