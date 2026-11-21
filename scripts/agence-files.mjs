// What `tools/agence/` ships in the runtime install (`<install>/agence/`): the
// launchers and the CLI, not its tests, fixtures or bytecode. The build id
// hashes the same files, so a CLI change makes a new build.

import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** Files an install must hold, relative to its root (the tarball's `required`). */
export const AGENCE_REQUIRED = [
  'agence',
  'agence-hook',
  'agence.py',
  'backlog.py',
  'lentilles.json',
  'pratiques.py',
  'pratiques.json',
  'metiers.py',
  'metiers.json',
  'connecteurs.json'
].map((file) => path.join('agence', file))

const NOT_SHIPPED = /^(test_.*\.py|__pycache__|fixtures|\..*)$/

/** Copies the shipped files of `source` (`tools/agence`) to `<stageDir>/agence/`, modes kept. */
export function stageAgence(source, stageDir) {
  for (const file of agenceFiles(source)) {
    const target = path.join(stageDir, 'agence', file)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join(source, file), target)
  }
}

/** Shipped files under `dir` (the checkout's `tools/agence`), relative, sorted. */
export function agenceFiles(dir, prefix = '') {
  return readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .filter((entry) => !NOT_SHIPPED.test(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const rel = path.join(prefix, entry.name)
      return entry.isDirectory() ? agenceFiles(dir, rel) : entry.isFile() ? [rel] : []
    })
}
