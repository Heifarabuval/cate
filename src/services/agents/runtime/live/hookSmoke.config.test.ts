import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { AGENTS } from '../../contract'
import matrix from '../../../../../scripts/agent-cli-matrix.json'
import { LIVE_CI_EXCLUSIONS, liveMatrixGaps, redactHookSmokeOutput, selectHookSmokeAgents } from './hookSmoke.config'

describe('live hook CI coverage', () => {
  test('every supported CLI is installed and tested by the matrix, unless excluded with a reason', () => {
    const ids = AGENTS.map((agent) => agent.id)
    expect(liveMatrixGaps(matrix, ids)).toEqual([])
    const live = ids.filter((id) => !(id in LIVE_CI_EXCLUSIONS)).sort()
    expect([...matrix].sort()).toEqual(live)
    const installer = readFileSync('scripts/install-agent-cli.sh', 'utf8')
    for (const id of live) expect(installer).toContain(`  ${id})`)
    expect(selectHookSmokeAgents().sort()).toEqual(live)
  })

  test('an agent missing from the matrix without a declared exclusion is a gap', () => {
    const ids = AGENTS.map((agent) => agent.id)
    const withoutCodex = ids.filter((id) => id !== 'codex' && !(id in LIVE_CI_EXCLUSIONS))
    expect(liveMatrixGaps(withoutCodex, ids)).toEqual(['codex'])
    // A declared exclusion still listed in the matrix is a contradiction too.
    expect(liveMatrixGaps([...ids], ids)).toEqual(Object.keys(LIVE_CI_EXCLUSIONS))
  })

  test('every exclusion names an agent and says why', () => {
    for (const [id, reason] of Object.entries(LIVE_CI_EXCLUSIONS)) {
      expect(AGENTS.some((agent) => agent.id === id), id).toBe(true)
      expect(reason?.trim().length, id).toBeGreaterThan(20)
    }
  })

  test('selection fails closed for empty or unknown agents', () => {
    expect(selectHookSmokeAgents('codex, cursor,codex')).toEqual(['codex', 'cursor'])
    for (const selection of ['', 'codxe', 'codex,']) expect(() => selectHookSmokeAgents(selection)).toThrow('Unknown hook smoke agent')
  })

  test('failure diagnostics redact provider and hook credentials', () => {
    expect(redactHookSmokeOutput('token abcdefgh and secret 12345678', {
      CURSOR_API_KEY: 'abcdefgh', CATE_HOOK_TOKEN: '12345678', PATH: '/usr/bin',
    })).toBe('token [REDACTED] and secret [REDACTED]')
  })
})
