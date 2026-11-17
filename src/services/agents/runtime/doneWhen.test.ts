import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDoneWhen, runDoneWhenCommand, type DoneWhenDeps, type DoneWhenRun } from './doneWhen'

function setup(run: DoneWhenDeps['run']) {
  const open = new Set(['agent'])
  const deps = {
    run: vi.fn(run),
    panelTitle: (panelId: string) => (open.has(panelId) ? 'Fix login' : undefined),
    close: vi.fn((panelId: string) => { open.delete(panelId) }),
    notify: vi.fn(),
    now: () => 42,
  }
  const doneWhen = createDoneWhen(deps)
  doneWhen.watch('agent', { command: 'npm test', cwd: '/repo/wt', callerPanelId: 'lead' })
  return { doneWhen, deps, open }
}

describe('done-when conditions', () => {
  it('exit 0 closes the panel in the agent checkout and tells the caller', async () => {
    const { doneWhen, deps } = setup(async () => ({ exitCode: 0 }))
    await doneWhen.check('agent')
    expect(deps.run).toHaveBeenCalledWith('npm test', '/repo/wt')
    expect(deps.close).toHaveBeenCalledWith('agent')
    expect(deps.notify).toHaveBeenCalledWith('lead', { panelId: 'agent', title: 'Fix login', command: 'npm test' })
    expect(doneWhen.state('agent')).toBeUndefined()
  })

  it('a non-zero exit changes nothing but the last result, and checks again next turn', async () => {
    const { doneWhen, deps } = setup(async () => ({ exitCode: 1 }))
    await doneWhen.check('agent')
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(doneWhen.state('agent')).toEqual({ command: 'npm test', checking: false, last: { at: 42, outcome: 'notDone', exitCode: 1 } })
    await doneWhen.check('agent')
    expect(deps.run).toHaveBeenCalledTimes(2)
  })

  it('a timeout or an error is kept as the reason, the panel stays', async () => {
    const timedOut = setup(async () => ({ timedOut: true }))
    await timedOut.doneWhen.check('agent')
    expect(timedOut.deps.close).not.toHaveBeenCalled()
    expect(timedOut.doneWhen.state('agent')?.last).toEqual({ at: 42, outcome: 'timeout', reason: 'timed out after 60 s' })
    const failed = setup(async () => { throw new Error('spawn sh ENOENT') })
    await failed.doneWhen.check('agent')
    expect(failed.doneWhen.state('agent')?.last).toEqual({ at: 42, outcome: 'error', reason: 'spawn sh ENOENT' })
  })

  it('a panel already closed is not checked, nor closed or announced when it closes during the check', async () => {
    const before = setup(async () => ({ exitCode: 0 }))
    before.open.clear()
    await before.doneWhen.check('agent')
    expect(before.deps.run).not.toHaveBeenCalled()
    expect(before.doneWhen.state('agent')).toBeUndefined()

    let finish!: (run: DoneWhenRun) => void
    const during = setup(() => new Promise((resolve) => { finish = resolve }))
    const checking = during.doneWhen.check('agent')
    during.open.clear()
    finish({ exitCode: 0 })
    await checking
    expect(during.deps.close).not.toHaveBeenCalled()
    expect(during.deps.notify).not.toHaveBeenCalled()
  })

  it('runs one check at a time per panel, and checks once more for turn-ends during it', async () => {
    let finish!: (run: DoneWhenRun) => void
    const { doneWhen, deps } = setup(() => new Promise((resolve) => { finish = resolve }))
    const first = doneWhen.check('agent')
    expect(doneWhen.state('agent')?.checking).toBe(true)
    await doneWhen.check('agent')
    await doneWhen.check('agent')
    expect(deps.run).toHaveBeenCalledTimes(1)
    finish({ exitCode: 3 })
    await vi.waitFor(() => expect(deps.run).toHaveBeenCalledTimes(2))
    finish({ exitCode: 3 })
    await first
    expect(deps.run).toHaveBeenCalledTimes(2)
    expect(doneWhen.state('agent')?.checking).toBe(false)
  })

  it('a turn-end during a failing check reruns it once it ends, and closes when the condition became true', async () => {
    let finishFirst!: (run: DoneWhenRun) => void
    const runs: Array<() => Promise<DoneWhenRun>> = [
      () => new Promise((resolve) => { finishFirst = resolve }),
      async () => ({ exitCode: 0 }),
    ]
    const { doneWhen, deps } = setup(() => runs.shift()!())
    const first = doneWhen.check('agent')
    await doneWhen.check('agent')
    finishFirst({ exitCode: 1 })
    await first
    expect(deps.run).toHaveBeenCalledTimes(2)
    expect(deps.close).toHaveBeenCalledWith('agent')
    expect(deps.notify).toHaveBeenCalledTimes(1)
  })

  it('watching without a condition drops the previous one', async () => {
    const { doneWhen, deps } = setup(async () => ({ exitCode: 0 }))
    doneWhen.watch('agent', null)
    await doneWhen.check('agent')
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('done-when.json', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function persisted(open: Set<string>, run: DoneWhenDeps['run'] = async () => ({ exitCode: 1 })) {
    const file = path.join(dir, 'done-when.json')
    const deps = {
      file,
      run: vi.fn(run),
      panelTitle: (panelId: string) => (open.has(panelId) ? 'Fix login' : undefined),
      close: vi.fn((panelId: string) => { open.delete(panelId) }),
      notify: vi.fn(),
    }
    return { doneWhen: createDoneWhen(deps), deps, read: () => JSON.parse(readFileSync(file, 'utf8')) }
  }

  it('writes a condition at start and drops it when the panel closes or is removed', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cate-done-when-file-'))
    const open = new Set(['agent', 'other'])
    const first = persisted(open, async () => ({ exitCode: 0 }))
    first.doneWhen.watch('agent', { command: 'npm test', cwd: '/repo/wt', callerPanelId: 'lead' })
    first.doneWhen.watch('other', { command: 'true', cwd: '/repo' })
    first.doneWhen.dispose()
    expect(first.read()).toEqual({ agent: { command: 'npm test', cwd: '/repo/wt', callerPanelId: 'lead' }, other: { command: 'true', cwd: '/repo' } })

    const second = persisted(open, async () => ({ exitCode: 0 }))
    await second.doneWhen.check('agent')
    open.delete('other')
    second.doneWhen.prune()
    second.doneWhen.dispose()
    expect(second.read()).toEqual({})
  })

  it('reads conditions back at runtime start and checks each once, skipping panels that are gone', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cate-done-when-file-'))
    writeFileSync(path.join(dir, 'done-when.json'), JSON.stringify({
      agent: { command: 'npm test', cwd: '/repo/wt', callerPanelId: 'lead' },
      gone: { command: 'true', cwd: '/repo' },
      broken: { cwd: '/repo' },
    }))
    const open = new Set(['agent', 'broken'])
    const { doneWhen, deps, read } = persisted(open, async () => ({ exitCode: 0 }))
    expect(doneWhen.state('agent')).toEqual({ command: 'npm test', checking: false })
    await doneWhen.resume()
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.run).toHaveBeenCalledWith('npm test', '/repo/wt')
    expect(deps.close).toHaveBeenCalledWith('agent')
    expect(deps.notify).toHaveBeenCalledWith('lead', { panelId: 'agent', title: 'Fix login', command: 'npm test' })
    doneWhen.dispose()
    expect(read()).toEqual({})
  })
})

describe.skipIf(process.platform === 'win32')('runDoneWhenCommand', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('runs a shell command in the checkout and reports its exit code', async () => {
    dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cate-done-when-')))
    expect(await runDoneWhenCommand('[ "$(pwd -P)" = "$EXPECTED" ]', dir, { ...process.env, EXPECTED: dir })).toEqual({ exitCode: 0 })
    expect(await runDoneWhenCommand('exit 7', dir, process.env)).toEqual({ exitCode: 7 })
  })

  it('kills a command past its timeout', async () => {
    dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cate-done-when-')))
    const started = Date.now()
    expect(await runDoneWhenCommand('sleep 5 | cat', dir, process.env, 100)).toEqual({ timedOut: true })
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
