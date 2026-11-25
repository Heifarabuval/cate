import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AGENCE_REQUIRED, agenceFiles, stageAgence } from './agence-files.mjs'

// macOS arm64 uniquement (le régisseur est un processus POSIX)
const itPosix = it.skipIf(process.platform === 'win32')

let dir
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function checkout() {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cate-agence-stage-'))
  const write = (file, text, mode = 0o644) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
    chmodSync(path.join(dir, file), mode)
  }
  write('tools/agence/agence', '#!/bin/sh\n', 0o755)
  write('tools/agence/agence-hook', '#!/bin/sh\n', 0o755)
  write('tools/agence/agence.py', 'print(1)\n')
  write('tools/agence/backlog.py', 'print(1)\n')
  write('tools/agence/lentilles.json', '[]')
  write('tools/agence/pratiques.py', 'print(1)\n')
  write('tools/agence/pratiques.json', '{}')
  write('tools/agence/metiers.py', 'print(1)\n')
  write('tools/agence/setup.py', 'print(1)\n')
  write('tools/agence/metiers.json', '[]')
  write('tools/agence/connecteurs.json', '[]')
  write('tools/agence/test_agence.py', 'assert 1\n')
  write('tools/agence/test_launcher.py', 'assert 1\n')
  write('tools/agence/__pycache__/agence.cpython-314.pyc', 'x')
  write('tools/agence/fixtures/etat/etat.json', '{}')
  return path.join(dir, 'tools', 'agence')
}

it('lists the launchers, the CLI, its backlog module, its lenses, its practices schema and its trades catalogues as required', () => {
  expect(AGENCE_REQUIRED).toEqual(
    [
      'agence', 'agence-hook', 'agence.py', 'backlog.py', 'lentilles.json', 'pratiques.py', 'pratiques.json',
      'metiers.py', 'setup.py', 'metiers.json', 'connecteurs.json'
    ].map((f) => path.join('agence', f))
  )
})

it('ships the launchers and the CLI, not tests, fixtures or bytecode', () => {
  expect(agenceFiles(checkout())).toEqual([
    'agence', 'agence-hook', 'agence.py', 'backlog.py', 'connecteurs.json', 'lentilles.json', 'metiers.json', 'metiers.py',
    'pratiques.json', 'pratiques.py', 'setup.py'
  ])
})

itPosix('stages agence/ into the install with the launcher executable', () => {
  const source = checkout()
  const stage = path.join(dir, 'stage')
  mkdirSync(stage)
  stageAgence(source, stage)
  for (const rel of AGENCE_REQUIRED) expect(existsSync(path.join(stage, rel)), rel).toBe(true)
  expect(existsSync(path.join(stage, 'agence', 'test_agence.py'))).toBe(false)
  expect(statSync(path.join(stage, 'agence', 'agence')).mode & 0o111).not.toBe(0)
  expect(statSync(path.join(stage, 'agence', 'agence-hook')).mode & 0o111).not.toBe(0)
})
