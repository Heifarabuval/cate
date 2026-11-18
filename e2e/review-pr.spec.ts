// `cate panel create review --pr` in the real app: a real Cate terminal runs the CLI, the runtime reads the pull
// request through a fake `gh` first on PATH, and the desktop review view shows it. No network, no GitHub.

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { closeApp, makeHome, makeProject, seedOnCanvas } from './fixtures/electron-app'
import { launchWithRuntime } from './fixtures/runtime-install'
import { runCate } from './fixtures/cate-terminal'

const view = {
  number: 8, url: 'https://github.com/org/repo/pull/8', title: 'Fix the login loop', author: { login: 'ana' }, body: 'Stops the redirect loop.',
  state: 'OPEN', isDraft: false, headRefName: 'fix-login', baseRefName: 'main', isCrossRepository: false,
  commits: [{ oid: 'abcdef1234567', messageHeadline: 'fix: stop the redirect loop', authors: [{ login: 'ana' }], committedDate: '2026-11-17T09:00:00Z' }],
  changedFiles: 1, additions: 1, deletions: 1,
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/org/repo/actions/runs/1' }],
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
}
const files = [{
  filename: 'src/login.ts', status: 'modified', additions: 1, deletions: 1,
  patch: '@@ -1 +1 @@\n-redirect(login)\n+return home()', blob_url: 'https://github.com/org/repo/blob/x/src/login.ts',
}]

let app: ElectronApplication
let page: Page
let home = ''

test.skip(process.platform === 'win32', 'the fake gh is a POSIX script')

test.beforeEach(async () => {
  home = makeHome()
  const bin = path.join(home, 'fake-gh')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
process.stdout.write(JSON.stringify(process.argv[2] === 'api' ? ${JSON.stringify(files)} : ${JSON.stringify(view)}))
`)
  chmodSync(path.join(bin, 'gh'), 0o755)
  // The runtime takes its PATH from a login shell: the profiles put the fake gh first.
  for (const file of ['.zprofile', '.zshrc', '.bash_profile', '.profile']) writeFileSync(path.join(home, file), `export PATH=${JSON.stringify(bin)}:"$PATH"\n`)
  const workspace = makeProject(home)
  ;({ electronApp: app, mainWindow: page } = await launchWithRuntime({ home, workspace, env: { CATE_E2E_PATH_PREPEND: bin, PATH: `${bin}:${process.env.PATH ?? ''}` } }))
})
test.afterEach(async () => closeApp(app, { home }))

test('a review panel opened with --pr shows the pull request and its file diffs', async () => {
  const terminal = (await seedOnCanvas(page, 'terminal', { x: 120, y: 120 })).panelId
  await runCate(page, terminal, 'panel', 'create', 'review', '--pr', 'org/repo#8')

  await expect(page.getByText('Fix the login loop')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Checks passing')).toBeVisible()
  await expect(page.getByText('Mergeable', { exact: true })).toBeVisible()
  const expand = page.getByRole('button', { name: 'Expand src/login.ts' })
  // The first click on an unfocused canvas panel focuses it.
  const overlay = page.locator('[data-node-id]').filter({ has: expand }).locator('[data-unfocused-overlay]')
  if (await overlay.count()) await overlay.click()
  await expand.click()
  await expect(page.getByText('return home()')).toBeVisible()
})
