// A pull request panel: what the session read through `gh`, read only (no comment, approval or merge).
import React, { useEffect } from 'react'
import { ChevronDown as CaretDown, ChevronRight as CaretRight, ExternalLink, GitPullRequest, RefreshCw } from 'lucide-react'
import { LoadingState, PanelCenteredState } from '../../kernel/interaction'
import { clientUi } from '@kernel/interaction'
import type { PullRequestDetails, PullRequestFile } from '@workspace/repository/contract'
import type { ReviewPrState, ReviewSnapshot } from '@panels/review/contract'
import { ReviewStats, ToolbarButton } from './ReviewControls'
import { DiffPageBody } from './DiffPageBody'
import { useReviewView, type ReviewSend } from './useReview'

/** How often a visible view asks for fresh checks; the session ignores a tick that comes too soon or during a read. */
const TICK_MS = 25_000

const MERGEABILITY: Record<NonNullable<PullRequestDetails['mergeability']>, string> = {
  mergeable: 'Mergeable', conflict: 'Conflicts', blocked: 'Blocked', computing: 'Checking mergeability',
}
const CHECKS: Record<PullRequestDetails['checks']['state'], string> = {
  passing: 'Checks passing', failing: 'Checks failing', pending: 'Checks running', none: 'No checks',
}
const TONE: Record<string, string> = {
  passing: 'text-diff-add', mergeable: 'text-diff-add', failing: 'text-diff-del', conflict: 'text-diff-del', blocked: 'text-diff-del',
}
const NO_DIFF: Record<Exclude<PullRequestFile['diff'], 'patch'>, string> = {
  binary: 'No diff for this file (binary).', 'too-large': 'This diff is too large to show here.', none: 'Renamed without changes.',
}

export default function PullRequestView({ workspaceId, panelId, snapshot, pr, send, visible }: {
  workspaceId: string
  panelId: string
  snapshot: ReviewSnapshot
  pr: ReviewPrState
  send: ReviewSend
  visible: boolean
}) {
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => { void send({ kind: 'prTick' }).catch(() => {}) }, TICK_MS)
    return () => clearInterval(timer)
  }, [send, visible])
  const name = pr.ref ? `${pr.ref.repository}#${pr.ref.number}` : 'pull request'
  const retry = <button type="button" aria-label="Retry" disabled={pr.loading} className="underline disabled:opacity-30" onClick={() => void send({ kind: 'refresh' })}>Retry</button>
  const { data, error } = pr
  if (!data) {
    if (!error) return <LoadingState label={`Loading pull request ${name}`} className="h-full p-4 text-xs" />
    return <div role="alert" className="h-full"><PanelCenteredState icon={<GitPullRequest size={28} />} title={`Could not read ${name}`} description={error.message} actions={retry} /></div>
  }
  return <PullRequestBody workspaceId={workspaceId} panelId={panelId} snapshot={snapshot} pr={pr} data={data} send={send} retry={retry} />
}

function PullRequestBody({ workspaceId, panelId, snapshot, pr, data, send, retry }: {
  workspaceId: string
  panelId: string
  snapshot: ReviewSnapshot
  pr: ReviewPrState
  data: PullRequestDetails
  send: ReviewSend
  retry: React.ReactNode
}) {
  const view = useReviewView(workspaceId, panelId, snapshot)
  const state = data.draft && data.state === 'open' ? 'draft' : data.state
  return <div className="flex w-full min-w-0 h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-primary">
    <div role="toolbar" aria-label="Pull request" className="flex min-w-0 shrink-0 items-center gap-1.5 border-b border-subtle bg-surface-1 px-2 py-1.5">
      <GitPullRequest size={14} className="shrink-0 text-muted" />
      <span className="min-w-0 truncate text-xs font-medium">{data.title}</span>
      <span className="shrink-0 text-xs text-muted">#{data.number}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ReviewStats files={data.fileCount} additions={data.additions} deletions={data.deletions} />
        <ToolbarButton label="Refresh pull request" disabled={pr.loading} onClick={() => void send({ kind: 'refresh' })}><RefreshCw size={14} className={pr.loading ? 'animate-spin' : ''} /></ToolbarButton>
        <ToolbarButton label="Open on GitHub" onClick={() => clientUi().openExternal(data.url)}><ExternalLink size={14} /></ToolbarButton>
      </div>
    </div>
    {pr.error && <p role="alert" className="shrink-0 px-3 py-2 text-xs text-red-400">{pr.error.message} {retry}</p>}
    <div data-review-scroll className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <section className="space-y-1.5 border-b border-subtle px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-secondary">
          <span className="rounded-full border border-subtle px-2 py-0.5 capitalize">{state}</span>
          <span>{data.author}</span>
          <span className="font-mono text-[11px]">{data.head} → {data.base}</span>
          <span className={TONE[data.checks.state] ?? ''}>{CHECKS[data.checks.state]}</span>
          {data.mergeability && <span className={TONE[data.mergeability] ?? ''}>{MERGEABILITY[data.mergeability]}</span>}
        </div>
        {data.body && <p className="whitespace-pre-wrap break-words text-secondary">{data.body}</p>}
      </section>
      {data.checks.items.length > 0 && <Section title={`Checks (${data.checks.items.length})`}>
        {data.checks.items.map((check, index) => <li key={index} className="flex gap-2 px-3 py-0.5"><span className={`w-14 shrink-0 ${TONE[check.result] ?? 'text-muted'}`}>{check.result}</span><span className="min-w-0 truncate">{check.name}</span></li>)}
      </Section>}
      <Section title={`Commits (${data.commitsTruncated ? `${data.commits.length} of ${data.commitCount}` : data.commitCount})`}>
        {data.commits.map((commit) => <li key={commit.oid} className="flex gap-2 px-3 py-0.5"><span title={commit.oid} className="shrink-0 font-mono text-muted">{commit.oid.slice(0, 7)}</span><span className="min-w-0 flex-1 truncate">{commit.title}</span><span className="shrink-0 text-muted">{commit.author}</span></li>)}
      </Section>
      {data.filesTruncated && <p className="px-3 py-1 text-xs text-muted">Showing {data.files.length} of {data.fileCount} files.</p>}
      {data.files.map((file) => {
        const key = `pr:${file.path}`
        const open = view.expanded.has(key)
        return <section key={key} data-review-file={encodeURIComponent(file.path)} className="min-w-0 border-b border-subtle">
          <div className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-subtle bg-surface-2/95 px-2 py-1.5 backdrop-blur">
            <button aria-label={`${open ? 'Collapse' : 'Expand'} ${file.path}`} aria-expanded={open} onClick={() => view.toggleExpanded(key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.oldPath ? `${file.oldPath} → ` : ''}{file.path}</span>
            </button>
            <span className="text-[10px] text-muted">{file.status}</span>
            <span className="text-[10px] tabular-nums text-diff-add">+{file.additions}</span><span className="text-[10px] tabular-nums text-diff-del">−{file.deletions}</span>
          </div>
          {open && (file.diff === 'patch'
            ? <DiffPageBody
              loadKey={`${pr.readAt}:${file.path}`}
              load={(page) => send({ kind: 'prFileDiff', path: file.path, page })}
              display={view.display}
              page={view.pageFor(key)}
              setPage={(page) => view.setPage(key, page)}
              numbered
              loading="Loading file diff…"
              failure="Could not load this file."
            />
            : <p className="px-3 py-2 text-xs text-muted">{NO_DIFF[file.diff]}</p>)}
        </section>
      })}
    </div>
  </div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-b border-subtle py-1.5 text-xs">
    <h3 className="px-3 pb-1 text-[11px] font-medium text-muted">{title}</h3>
    <ul>{children}</ul>
  </section>
}
