import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { computeBuildId } from './build-id.mjs'

let dir
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function repo() {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cate-build-id-'))
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  write('package.json', '{"version":"1.0.0"}')
  write('package-lock.json', '{"lockfileVersion":3}')
  write('src/kernel/a.ts', 'export const a = 1\n')
  write('skills/cate-cli/SKILL.md', '# cate\n')
  write('tools/agence/agence', '#!/bin/sh\n')
  write('tools/agence/agence.py', 'print(1)\n')
  write('tools/agence/test_agence.py', 'assert 1\n')
  return write
}

it('changes with every input of the install', () => {
  const write = repo()
  let id = computeBuildId(dir)
  for (const [file, text] of [
    ['src/kernel/a.ts', 'export const a = 2\n'],
    ['skills/cate-cli/SKILL.md', '# cate, changed\n'],
    ['tools/agence/agence.py', 'print(2)\n'],
    ['tools/agence/agence', '#!/bin/sh\nexit 0\n'],
    ['package-lock.json', '{"lockfileVersion":3,"x":1}'],
  ]) {
    write(file, text)
    const next = computeBuildId(dir)
    expect(next, file).not.toBe(id)
    id = next
  }
})

it('ignores what the install does not ship from tools/agence', () => {
  const write = repo()
  const id = computeBuildId(dir)
  write('tools/agence/test_agence.py', 'assert 2\n')
  write('tools/agence/__pycache__/agence.cpython-314.pyc', 'x')
  expect(computeBuildId(dir)).toBe(id)
})
