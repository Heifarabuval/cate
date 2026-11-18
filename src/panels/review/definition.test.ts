import { describe, expect, it } from 'vitest'
import { isRpcError } from '@kernel/rpc/contract'
import { createPanelKit, type PanelKit } from '@panels/framework/contract'
import type { PanelRecord, WorkspaceDocument } from '@workspace/document/contract'
import type { PullRequestRef } from '@workspace/repository/contract'
import reviewDefinition from './definition'
import type { ReviewCreateOptions } from './contract/types'

function harness() {
  const panels: Record<string, PanelRecord> = {}
  const added: PanelRecord[] = []
  let next = 0
  const kit: PanelKit = createPanelKit({
    document: () => ({ panels, worktrees: {} }) as unknown as WorkspaceDocument,
    newId: () => `p${++next}`,
    definitionOf: () => reviewDefinition,
    add(record) {
      panels[record.id] = record
      added.push(record)
      return record.id
    },
  })
  const create = (options: ReviewCreateOptions) => reviewDefinition.create!(options, kit)
  /** A review panel already in the document, id p0. */
  const seed = (fields: PanelRecord['fields']) => { panels.p0 = { id: 'p0', type: 'review', title: 'PR', fields } }
  return { create, added, seed }
}

const prOf = (record: PanelRecord | undefined) => (record?.fields as { pr?: unknown } | undefined)?.pr

describe('review definition with a pull request', () => {
  it('records the pull request without a worktree or a checkout', () => {
    const { create, added } = harness()

    const id = create({ pr: 'Org/Repo#8' })

    expect(id).toBe('p1')
    expect(added).toHaveLength(1)
    expect(added[0].fields).toEqual({ repoPath: '', pr: { repository: 'org/repo', number: 8 } })
    expect(added[0].worktreeId).toBeUndefined()
    expect(added[0].title).toBe('PR #8')
  })

  it('keeps a given title', () => {
    const { create, added } = harness()
    create({ pr: 'org/repo#8', title: '#8 Fix it' })
    expect(added[0].title).toBe('#8 Fix it')
  })

  it('leaves the repository open for a bare number, and takes a parsed ref', () => {
    const { create, added } = harness()
    create({ pr: '8' })
    create({ pr: { repository: 'org/repo', number: 9 } })
    expect(prOf(added[0])).toEqual({ repository: null, number: 8 })
    expect(prOf(added[1])).toEqual({ repository: 'org/repo', number: 9 })
  })

  it('opens the same pull request twice as one panel', () => {
    const { create, added } = harness()

    const first = create({ pr: 'org/repo#8' })
    const second = create({ pr: 'org/repo#8' })

    expect(second).toBe(first)
    expect(added).toHaveLength(1)
  })

  it('ignores the case of the repository and the spelling of the reference', () => {
    const { create, added } = harness()

    const first = create({ pr: 'Org/Repo#8' })

    expect(create({ pr: 'org/REPO#8' })).toBe(first)
    expect(create({ pr: 'https://github.com/ORG/repo/pull/8' })).toBe(first)
    expect(added).toHaveLength(1)
  })

  it('opens another pull request as another panel', () => {
    const { create, added } = harness()

    const first = create({ pr: 'org/repo#8' })
    const other = create({ pr: 'org/repo#9' })
    const elsewhere = create({ pr: 'org/other#8' })

    expect(new Set([first, other, elsewhere]).size).toBe(3)
    expect(added).toHaveLength(3)
  })

  it('treats an unresolved repository as equal to itself', () => {
    const { create, added } = harness()

    const first = create({ pr: '8' })

    expect(create({ pr: '#8' })).toBe(first)
    expect(added).toHaveLength(1)
  })

  it('finds a panel the session resolved from the origin by its bare number and by its full reference', () => {
    const { create, added, seed } = harness()
    seed({ repoPath: '', pr: { repository: 'org/repo', number: 8, origin: true } })

    expect(create({ pr: '8' })).toBe('p0')
    expect(create({ pr: '#8' })).toBe('p0')
    expect(create({ pr: 'org/repo#8' })).toBe('p0')
    expect(added).toHaveLength(0)
    expect(create({ pr: 'other/repo#8' })).not.toBe('p0')
    expect(create({ pr: '9' })).not.toBe('p0')
    expect(added).toHaveLength(2)
  })

  it('cannot tell a bare number from a full reference until the session knows the origin', () => {
    const { create, added, seed } = harness()
    seed({ repoPath: '', pr: { repository: 'org/repo', number: 8 } })

    expect(create({ pr: '8' })).not.toBe('p0')
    expect(added).toHaveLength(1)
  })

  it('refuses an invalid reference and adds no panel', () => {
    const { create, added } = harness()
    const invalid: ReviewCreateOptions['pr'][] = [
      'abc', '0', '-1', 'a/b#', '', '-x', '../..#8', 'org/repo\n#8', `${'a'.repeat(5000)}/repo#8`, '#-1', '8.5',
      { repository: '../..', number: 8 },
      { repository: '-x/repo', number: 8 },
      { repository: 'org/repo\n', number: 8 },
      { repository: `${'a'.repeat(5000)}/repo`, number: 8 },
      { repository: 'org/repo', number: -1 },
      { repository: 'org/repo', number: 1.5 },
      { repository: null, number: 0 },
      { repository: 5, number: 8 } as unknown as PullRequestRef,
    ]

    for (const pr of invalid) {
      let error: unknown
      try { create({ pr }) } catch (e) { error = e }
      expect(isRpcError(error, 'rejected'), JSON.stringify(pr)).toBe(true)
      expect((error as Error).message).toBe('Expected owner/repo#N or N')
    }
    expect(added).toHaveLength(0)
  })

  it('takes a parsed reference as GitHub spells it, lowercased', () => {
    const { create, added } = harness()
    create({ pr: { repository: 'Org/Repo', number: 8 } })
    expect(prOf(added[0])).toEqual({ repository: 'org/repo', number: 8 })
  })

  it('does not take an agent review for a pull request', () => {
    const { create, added } = harness()

    create({ repoPath: '/repo' })
    create({ repoPath: '/repo' })

    expect(added).toHaveLength(2)
    expect(added[0].fields).toEqual({ repoPath: '/repo' })
    expect(added[0].title).toBe('Agent Review')
  })

  it('builds the record fields from the options', () => {
    expect(reviewDefinition.fields?.({ pr: 'org/repo#8' })).toEqual({ repoPath: '', pr: { repository: 'org/repo', number: 8 } })
    expect(reviewDefinition.fields?.({ repoPath: '/repo' })).toEqual({ repoPath: '/repo' })
  })

  it('has no checkout and describes itself by its reference', () => {
    const record = (fields: PanelRecord['fields']): PanelRecord => ({ id: 'r', type: 'review', title: 't', fields })

    const pr = record({ repoPath: '', pr: { repository: 'org/repo', number: 8 } })
    expect(reviewDefinition.checkoutPath?.(pr)).toBeUndefined()
    expect(reviewDefinition.describe?.(pr)).toBe('org/repo#8')
    expect(reviewDefinition.describe?.(record({ repoPath: '', pr: { repository: null, number: 8 } }))).toBe('#8')

    const agent = record({ repoPath: '/repo' })
    expect(reviewDefinition.checkoutPath?.(agent)).toBe('/repo')
    expect(reviewDefinition.describe?.(agent)).toBe('/repo')
  })
})
