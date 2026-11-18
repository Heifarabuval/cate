// The review panel type: recorded agent edits. Pure.

import { channel, RpcError } from '@kernel/rpc/contract'
import { definePanel } from '@panels/framework/contract'
import type { JsonObject } from '@workspace/document/contract'
import { parsePullRequestRef, prKey, type PullRequestRef } from '@workspace/repository/contract'
import {
  reviewPullRequest,
  reviewRepoPath,
  type ReviewCreateOptions,
  type ReviewFields,
  type ReviewOp,
  type ReviewOpenRequest,
  type ReviewPullRequest,
  type ReviewSnapshot,
} from './contract/types'

function fields(repoPath: string, request: ReviewOpenRequest | undefined, pr?: PullRequestRef): JsonObject {
  const value: ReviewFields = { repoPath, ...(request ? { request } : {}), ...(pr ? { pr } : {}) }
  return value as unknown as JsonObject
}

/** The options' pull request, or null without one. Text and parsed refs pass the same check, before any record. */
function requestedPullRequest(options: ReviewCreateOptions): PullRequestRef | null {
  const pr: unknown = options.pr
  if (pr === undefined) return null
  const parsed = pr as Partial<PullRequestRef> | null
  const text = typeof pr === 'string' ? pr
    : parsed && typeof parsed === 'object' && (parsed.repository === null || typeof parsed.repository === 'string') && typeof parsed.number === 'number'
      ? `${parsed.repository ?? ''}#${parsed.number}`
      : null
  const ref = text === null ? null : parsePullRequestRef(text)
  if (!ref) throw new RpcError('rejected', 'Expected owner/repo#N or N')
  return ref
}

/** What a review panel answers to: its reference, and `#N` too once it is known to be in the workspace origin. */
function panelKeys(pr: ReviewPullRequest): string[] {
  const own = prKey(pr)
  return pr.origin ? [own, prKey({ repository: null, number: pr.number })] : [own]
}

export default definePanel({
  type: 'review',
  label: 'Agent Review',
  icon: 'git-compare',
  defaultSize: { width: 640, height: 500 },
  minimumSize: { width: 320, height: 220 },
  dropSize: { width: 540, height: 420 },
  canLiveOnCanvas: true,
  navigable: true,
  creation: { order: 8, toolbar: true, inWorktree: true },
  defaultTitle: 'Agent Review',
  channel: channel<ReviewSnapshot, Partial<ReviewSnapshot>, ReviewOp>(),
  fields: (options: ReviewCreateOptions) => fields(options.repoPath ?? '', options.request, requestedPullRequest(options) ?? undefined),
  create: (options: ReviewCreateOptions, kit) => {
    const pr = requestedPullRequest(options)
    if (pr) {
      // One panel per pull request: the same one again is that panel.
      const key = prKey(pr)
      const open = Object.values(kit.document().panels).find((panel) => {
        const other = panel.type === 'review' ? reviewPullRequest(panel.fields) : null
        return other !== null && panelKeys(other).includes(key)
      })
      if (open) return open.id
      return kit.add(kit.record('review', {
        id: kit.newId(),
        title: options.title ?? `PR #${pr.number}`,
        fields: fields('', undefined, pr),
      }), options)
    }
    const bound = options.worktreeId ? kit.document().worktrees[options.worktreeId]?.path : undefined
    const repoPath = options.repoPath ?? bound ?? ''
    const record = kit.record('review', {
      id: kit.newId(),
      title: options.title,
      worktreeId: options.worktreeId ?? kit.worktreeIdForPath(repoPath || undefined),
      fields: fields(repoPath, options.request),
    })
    return kit.add(record, options)
  },
  checkoutPath: (record) => reviewPullRequest(record.fields) ? undefined : reviewRepoPath(record.fields) || undefined,
  describe: (record) => {
    const pr = reviewPullRequest(record.fields)
    return pr ? prKey(pr) : reviewRepoPath(record.fields) || undefined
  },
  commands: [
    { id: 'review.refresh', title: 'Refresh Review', op: { kind: 'refresh' } },
  ],
  chrome: { worktreeChip: true },
  relation: {
    produces: 'changes',
    targetOptions: {
      execution: [['verify', 'Review in'], ['use', 'Use changes in'], ['context', 'Reference']],
      changes: [['verify', 'Review in'], ['context', 'Reference'], ['use', 'Use changes in']],
      findings: [['verify', 'Review in'], ['context', 'Reference'], ['use', 'Use changes in']],
      notes: [['context', 'Compare with'], ['verify', 'Review in'], ['use', 'Use changes in']],
    },
    instruction: () => 'Review the recorded agent edits. Report findings in your response; do not edit files unless asked.',
  },
})
