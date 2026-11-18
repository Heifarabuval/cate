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
import type { PrDiffPage, PrErrorKind, ReviewPrState } from '../../contract/types'

/** What a pull request panel needs from GitHub: the repository runtime's `github`, which refuses an untrusted
 *  workspace and runs at most 3 `gh` calls at once. Reads answer raw `gh` JSON, parsed by the repository contract. */
export interface ReviewGithub {
  pullRequestView(repository: string, number: number): Promise<unknown>
  /** The light read: state, draft, checks, mergeability. */
  pullRequestChecks(repository: string, number: number): Promise<unknown>
  pullRequestFiles(repository: string, number: number): Promise<unknown>
  /** `owner/name` of the workspace origin; null without a GitHub origin. */
  originRepository(): Promise<string | null>
}

export interface PullRequestSubjectDeps {
  ref: PullRequestRef
  github: ReviewGithub
  publish(state: ReviewPrState): void
  /** Writes the resolved origin into the record (`--pr N`). */
  recordRepository(repository: string): void
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

/** The least time between two reads a view's tick may start. */
export const PR_TICK_INTERVAL_MS = 25_000
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
  let disposed = false
  let closed!: () => void
  const whenClosed = new Promise<void>((resolve) => { closed = resolve })

  const set = (patch: Partial<ReviewPrState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    deps.publish(state)
  }

  function failed(error: unknown): void {
    const untrusted = isRpcError(error, 'untrusted')
    const ghError = untrusted ? null : toGhReadError(error)
    const kind: PrErrorKind = ghError?.kind ?? 'untrusted'
    // The data and its read times stay: they say how old what is shown is.
    set({ loading: false, error: { kind, message: ghError?.message ?? UNTRUSTED } })
  }

  /** Runs one read; ops waiting on it settle when the panel closes, whatever `gh` does. */
  function read(kind: Read['kind'], work: () => Promise<void>): Promise<void> {
    lastReadAt = Date.now()
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
    deps.recordRepository(resolved.repository)
    set({ ref: resolved })
    return resolved
  }

  async function readAll(): Promise<void> {
    set({ loading: true })
    const ref = await resolveRef()
    if (!ref || disposed) return
    // One gh call at a time per pull request: the files, then the view that needs them.
    const listed = parsePullRequestFiles(await github.pullRequestFiles(ref.repository, ref.number), ref.repository, ref.number)
    if (disposed) return
    const data = parsePullRequestView(await github.pullRequestView(ref.repository, ref.number), listed.files)
    if (disposed) return
    patches = new Map(Object.entries(listed.patches))
    const at = new Date().toISOString()
    set({ data, readAt: at, checksReadAt: at, error: null, loading: false })
  }

  async function readChecks(ref: Resolved): Promise<void> {
    const checks = parsePullRequestChecks(await github.pullRequestChecks(ref.repository, ref.number))
    if (disposed || !state.data) return
    set({ data: { ...state.data, ...checks }, checksReadAt: new Date().toISOString(), error: null })
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
      if (disposed) return
      return read('full', readAll)
    },
    async tick() {
      if (disposed || running || Date.now() - lastReadAt < PR_TICK_INTERVAL_MS) return false
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
      patches.clear()
      running = null
      closed()
    },
  }
}
