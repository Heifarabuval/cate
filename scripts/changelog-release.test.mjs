import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findChangelogRelease, parseChangelog } from '../src/shells/desktop/ui/app/dialogs/changelog'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf-8')
const { version } = JSON.parse(read('package.json'))

// What's New opens only when CHANGELOG.md has a dated section titled exactly
// with the app version, so a version bump without its section silences it.
describe('release coherence', () => {
  it('CHANGELOG.md has a dated section for the package.json version', () => {
    const release = findChangelogRelease(parseChangelog(read('CHANGELOG.md')), version)
    expect(release?.date, `no "## [${version}] - YYYY-MM-DD" section in CHANGELOG.md`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('the generated RUNTIME_VERSION equals package.json (run `npm run build:runtime`)', () => {
    expect(read('src/runtime/daemon/contract/version.ts')).toContain(`RUNTIME_VERSION = '${version}'`)
  })
})
