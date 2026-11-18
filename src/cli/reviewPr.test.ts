// `cate panel create review --pr` end to end: the real CLI engine, the real API router, the real panel
// factory and review definition, and review sessions that read through a fake `gh` first in a test PATH.
// No network, no GitHub, no Electron.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiRouter, ApiTokenRegistry } from '@kernel/api/runtime'
import { createLogger } from '@kernel/log/contract'
import { runCli, type ApiCallPort } from './engine'
import { CATE_API } from '@panels/api'
import { createPanelFactory, createPanelRegistry, type SessionStore } from '@panels/framework/runtime'
import { canvasApi, panelApi } from '@workspace/document/contract/api'
import { createDocumentService, registerDocumentApi, type DocumentService } from '@workspace/document/runtime'
import { createGithubHost } from '@workspace/repository/runtime'
import { ReviewSession, reviewDefinition as definition, type ReviewRepository, type ReviewSessionDeps } from '@panels/review/runtime'
import type { ReviewSnapshot } from '@panels/review/contract'
import type { ReviewGithub } from '@panels/review/session'

const view = {
  number: 8, url: 'https://github.com/org/repo/pull/8', title: 'Fix login', author: { login: 'ana' }, body: 'Body',
  state: 'OPEN', isDraft: false, headRefName: 'fix', baseRefName: 'main', isCrossRepository: false,
  commits: [{ oid: 'abcdef1', messageHeadline: 'fix', authors: [{ login: 'ana' }], committedDate: '2026-11-17T09:00:00Z' }],
  changedFiles: 1, additions: 1, deletions: 0,
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/org/repo/actions/runs/1' }],
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
}

let dir: string
let document: DocumentService
let sessions: ReviewSession[]
let origin: string | null
let host: ReturnType<typeof createGithubHost>
let ghLog: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-cli-'))
  const bin = path.join(dir, 'bin')
  ghLog = path.join(dir, 'gh.log')
  mkdirSync(bin)
  // The fake gh: records its arguments, answers the pull request view, and an empty file list.
  writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(ghLog)}, process.argv.slice(2).join(' ') + '\\n')
process.stdout.write(JSON.stringify(process.argv[2] === 'api' ? [] : ${JSON.stringify(view)}))
`)
  chmodSync(path.join(bin, 'gh'), 0o755)
  host = createGithubHost({ env: () => ({ ...process.env, PATH: bin }) })
  document = createDocumentService({ file: path.join(dir, 'document.json'), debounceMs: 60_000 })
  sessions = []
  origin = 'org/repo'
})

afterEach(() => {
  for (const session of sessions) session.dispose('shutdown')
  host.dispose()
  document.dispose()
  rmSync(dir, { recursive: true, force: true })
})

const github = (): ReviewGithub => ({
  originRepository: async () => origin,
  pullRequestView: (repository, number) => host.pullRequestView(repository, number),
  pullRequestChecks: (repository, number) => host.pullRequestChecks(repository, number),
  pullRequestFiles: (repository, number) => host.pullRequestFiles(repository, number),
})

function setup() {
  const deps: ReviewSessionDeps = { root: dir, repository: {} as ReviewRepository, agents: {} as ReviewSessionDeps['agents'], github: github() }
  const registry = createPanelRegistry([{ definition, session: ReviewSession as never }])
  const factory = createPanelFactory({ document, registry })
  const tokens = new ApiTokenRegistry(() => 'tok')
  const router = new ApiRouter({
    namespaces: [panelApi, canvasApi],
    document: { panel: () => undefined, panels: () => [] },
    presence: { activePanelId: () => undefined },
    sessions: { handleApi: async () => null },
    settings: { get: () => true },
    tokens,
  })
  registerDocumentApi(router, {
    document,
    presence: { activePanelId: () => undefined },
    checkRemoval: () => {},
    createPanel: (type, request) => factory.createPanel(type, { ...request }),
    relationKinds: () => [],
  })
  const caller = tokens.issue({ kind: 'cli', panelId: 'caller' }).caller
  const port: ApiCallPort = { call: (method, args) => router.call(caller, method, args), close: () => {} }

  async function cli(...argv: string[]) {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(argv, CATE_API, {
      env: { CATE_SOCKET: 'socket', CATE_TOKEN: 'tok' },
      cwd: dir,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      connect: () => port,
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  const reviews = () => Object.values(document.get().panels).filter((panel) => panel.type === 'review')
  const create = async (...pr: string[]) => {
    const result = await cli('panel', 'create', 'review', ...pr, '--json')
    return { ...result, panelId: result.code === 0 ? (JSON.parse(result.out) as { panelId: string }).panelId : null }
  }
  /** Starts the panel's session the way the daemon does when a client attaches. */
  async function attach(panelId: string) {
    const store: SessionStore = { read: () => undefined, write: () => {}, flush: async () => {} }
    const session = new ReviewSession(
      { panelId, document, store, log: createLogger('test'), surface: async () => undefined },
      document.get().panels[panelId],
      deps,
    )
    sessions.push(session)
    await session.start()
    return () => (session.snapshot() as unknown as ReviewSnapshot).pr!
  }
  return { cli, create, reviews, attach }
}

describe('cate panel create review --pr', () => {
  it('names --pr in its help, and says an open pull request is not brought to the front', async () => {
    const { cli } = setup()
    const help = await cli('panel', 'create', '--help')
    expect(help.out).toContain('--pr')
    expect(help.out).toContain('not brought to the front')
  })

  it('gives the same panel for the same pull request, and another for another one', async () => {
    const { create, reviews } = setup()
    const first = await create('--pr', 'org/repo#8')
    const again = await create('--pr', 'ORG/Repo#8')
    const other = await create('--pr', 'org/repo#9')
    expect(first.code).toBe(0)
    expect(again.panelId).toBe(first.panelId)
    expect(other.panelId).not.toBe(first.panelId)
    expect(reviews()).toHaveLength(2)
  })

  it('reads the pull request through gh, once the panel is attached', async () => {
    const { create, attach } = setup()
    const { panelId } = await create('--pr', 'org/repo#8')
    const pr = await attach(panelId!)
    await expect.poll(() => pr().data?.title).toBe('Fix login')
  })

  it.each([
    ['abc'], ['-x'], ['../..#8'], ['org/repo\n#8'], [`${'a'.repeat(5000)}/repo#8`], ['-1'], ['0'], ['org/repo#-1'],
  ])('refuses --pr %j, makes no panel and calls no gh', async (value) => {
    const { cli, reviews } = setup()
    const result = await cli('panel', 'create', 'review', `--pr=${value}`)
    expect(result.code).not.toBe(0)
    expect(result.err).toContain('Expected owner/repo#N or N')
    expect(reviews()).toHaveLength(0)
    await expect(import('node:fs').then((fs) => fs.existsSync(ghLog))).resolves.toBe(false)
  })

  it('takes a bare number for the workspace origin, and asks for owner/repo#N without one', async () => {
    const { create, reviews, attach } = setup()
    const withOrigin = await create('--pr', '8')
    expect(withOrigin.code).toBe(0)
    const resolved = await attach(withOrigin.panelId!)
    await expect.poll(() => resolved().data?.title).toBe('Fix login')

    origin = null
    const without = await create('--pr', '9')
    expect(without.code).toBe(0)
    const pr = await attach(without.panelId!)
    await expect.poll(() => pr().error?.message ?? '').toContain('Use owner/repo#N')
    expect(reviews()).toHaveLength(2)
  })
})
