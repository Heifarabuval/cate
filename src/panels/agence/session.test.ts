import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '@kernel/log/contract'
import { isRpcError } from '@kernel/rpc/contract'
import { createDocument, type Json, type PanelRecord, type WorkspaceDocument } from '@workspace/document/contract'
import { TERMINAL_RESTORE_LAUNCH, type SpawnParams, type TerminalStatus, type TerminalStatusChange } from '@services/terminal/contract'
import type { SessionKit } from '@panels/framework/runtime'
import type { AgenceOp, AgenceSnapshot, AgenceState, RegisseurView } from './contract'
import { AgenceSession, type AgenceSessionDeps } from './session'
import type { RegisseurAcquire, RegisseurHandle } from './parts/runtime/regisseur'
import type { StateFilesRead } from './parts/runtime/stateFiles'

function fakeTerminal() {
  const spawns: SpawnParams[] = []
  const closed: string[] = []
  const statuses: Record<string, TerminalStatus> = {}
  const listeners = new Set<(change: TerminalStatusChange) => void>()
  let seq = 0
  const service: AgenceSessionDeps['terminal'] = {
    async spawn(params) {
      spawns.push(params)
      const id = `pty-${++seq}`
      statuses[id] = {
        id, panelId: params.panelId ?? null, pid: 100 + seq, shell: '/bin/zsh', alive: true, exitCode: null,
        activity: { type: 'running', processName: 'claude' }, ports: [], cwd: params.cwd ?? null, suspended: false, viewers: 0,
      }
      return { id, pid: 100 + seq, shell: '/bin/zsh' }
    },
    close: (id) => { closed.push(id) },
    statuses: () => statuses,
    onStatusChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const update = (id: string, patch: Partial<TerminalStatus>) => {
    statuses[id] = { ...statuses[id], ...patch }
    for (const listener of listeners) listener({ [id]: statuses[id] })
  }
  return { service, spawns, closed, update }
}

function fakeRegisseurs(initial: RegisseurView['state'] = 'running') {
  const acquired: RegisseurAcquire[] = []
  const posts: Array<{ path: string; form: Record<string, string> }> = []
  let released = 0
  let view: RegisseurView = { state: initial, error: initial === 'missing' ? 'agence introuvable (agence)' : null, settingsHint: null }
  const listeners = new Set<(view: RegisseurView) => void>()
  /** What the next posts answer; a function can hold the answer back. */
  let answer: (path: string, form: Record<string, string>) => Promise<{ code: number; message: string }> = async () => ({ code: 200, message: 'ok' })
  return {
    regisseurs: {
      acquire(request: RegisseurAcquire): RegisseurHandle {
        acquired.push(request)
        let done = false
        return {
          view: () => view,
          onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
          post: async (path, form) => {
            posts.push({ path, form })
            return answer(path, form)
          },
          release() { if (!done) { done = true; released++ } },
        }
      },
    },
    acquired,
    posts,
    released: () => released,
    answer(next: typeof answer) { answer = next },
    set(next: Partial<RegisseurView>) {
      view = { ...view, ...next }
      for (const listener of listeners) listener(view)
    },
  }
}

function fakeFiles(initial: Partial<StateFilesRead> = {}) {
  let read: StateFilesRead = { state: null, drafts: {}, error: null, readAt: null, ...initial }
  let onChange: ((read: StateFilesRead) => void) | null = null
  const dirs: string[] = []
  let disposed = 0
  return {
    files: (dir: string, listener: (read: StateFilesRead) => void) => {
      dirs.push(dir)
      onChange = listener
      return { read: () => read, dispose: () => { disposed++ } }
    },
    dirs,
    disposed: () => disposed,
    set(next: Partial<StateFilesRead>) {
      read = { ...read, ...next }
      onChange?.(read)
    },
  }
}

function fakeKit(record: PanelRecord, saved?: Json, others: PanelRecord[] = []) {
  const doc: WorkspaceDocument = { ...createDocument(), panels: Object.fromEntries([record, ...others].map((panel) => [panel.id, panel])) }
  let stored = saved
  const kit = {
    panelId: record.id,
    document: { get: () => doc, apply: () => 1 },
    store: { read: () => stored, write: (value: Json) => { stored = value }, flush: async () => {} },
    log: createLogger('test'),
    surface: async () => undefined,
  } as unknown as SessionKit
  return { kit, stored: () => stored }
}

const record = (fields: Record<string, Json> = {}): PanelRecord => ({ id: 'ag1', type: 'agence', title: 'Agence : cate', fields })

const need = (id: string, patch: Record<string, unknown> = {}) => ({
  id, kind: 'task', title: id, ref: null, owner: 'agent', blocking: false, unblocks: null, panels: [], acceptance: null,
  budgetMin: null, evidence: null, status: 'open', closeFailed: false, agentBlocked: false, overBudget: false,
  updated: '2026-11-17T10:00:00+00:00', ...patch,
})
const state = (patch: Partial<AgenceState> = {}): AgenceState => ({
  repo: 'cate', ghRepo: null, agentsActive: 2, port: 4321, panels: {}, titles: {}, needs: [], drafts: [], questions: [], ...patch,
} as AgenceState)

function setup(options: { saved?: Json; regisseur?: RegisseurView['state']; files?: Partial<StateFilesRead>; others?: PanelRecord[]; fields?: Record<string, Json> } = {}) {
  const terminal = fakeTerminal()
  const regisseurs = fakeRegisseurs(options.regisseur)
  const files = fakeFiles(options.files)
  const leases: Array<{ panelId: string; revoked: boolean }> = []
  const k = fakeKit(record(options.fields), options.saved, options.others)
  const deps: AgenceSessionDeps = {
    root: '/repo',
    terminal: terminal.service,
    regisseurs: regisseurs.regisseurs,
    files: files.files,
    async cliEnv(panelId) {
      const lease = { panelId, revoked: false }
      leases.push(lease)
      return { env: { CATE_SOCKET: '/sock', CATE_TOKEN: `tok-${leases.length}`, PATH: '/bin' }, revoke() { lease.revoked = true } }
    },
  }
  const session = new AgenceSession(k.kit, record(options.fields), deps)
  return { session, terminal, regisseurs, files, leases, ...k }
}

const snap = (session: AgenceSession): AgenceSnapshot => session.snapshot()

describe('AgenceSession', () => {
  it('does nothing until start: no PTY, no regisseur, no file watch', () => {
    const { terminal, regisseurs, files, leases } = setup()
    expect(terminal.spawns).toEqual([])
    expect(regisseurs.acquired).toEqual([])
    expect(files.dirs).toEqual([])
    expect(leases).toEqual([])
  })

  it('starts the orchestrator at first start: a PTY of the panel launching /orchestrateur with Claude Code', async () => {
    const { session, terminal } = setup()
    await session.start()
    expect(terminal.spawns).toEqual([expect.objectContaining({
      panelId: 'ag1',
      cwd: '/repo',
      launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: '/orchestrateur' } },
    })])
    expect(terminal.spawns[0].restore).toBeUndefined()
    expect(snap(session)).toMatchObject({ ptyId: 'pty-1', orchestrator: 'running' })
  })

  it('resumes the orchestrator with the restore launch when the panel ran before', async () => {
    const { session, terminal } = setup({ saved: { knownTitles: {} } })
    await session.start()
    expect(terminal.spawns).toEqual([expect.objectContaining({ panelId: 'ag1', launch: TERMINAL_RESTORE_LAUNCH, restore: true })])
  })

  it('remembers it started, so a restart of the daemon resumes instead of starting a second orchestrator', async () => {
    const first = setup()
    await first.session.start()
    expect(first.stored()).toEqual({ knownTitles: {} })
  })

  it('works in the record\'s root when it has one', async () => {
    const { session, terminal, regisseurs, files } = setup({ fields: { root: '/other' } })
    await session.start()
    expect(terminal.spawns[0].cwd).toBe('/other')
    expect(regisseurs.acquired[0].root).toBe('/other')
    expect(files.dirs).toEqual(['/other/.cate/tmp/agence'])
  })

  it('takes a regisseur reference with a CLI env in its name at start, and gives both back at dispose', async () => {
    const { session, regisseurs, leases, files } = setup({ files: { state: state({ port: 4321 }) } })
    await session.start()
    expect(leases).toEqual([{ panelId: 'ag1', revoked: false }])
    expect(regisseurs.acquired).toEqual([expect.objectContaining({ root: '/repo', env: { CATE_SOCKET: '/sock', CATE_TOKEN: 'tok-1', PATH: '/bin' } })])
    expect(regisseurs.acquired[0].port()).toBe(4321)
    expect(snap(session).regisseur).toEqual({ state: 'running', error: null, settingsHint: null })
    session.dispose('removed')
    expect(regisseurs.released()).toBe(1)
    expect(leases[0].revoked).toBe(true)
    expect(files.disposed()).toBe(1)
  })

  it('gives everything back when it is disposed while starting', async () => {
    const { session, regisseurs, leases, terminal } = setup()
    const started = session.start()
    session.dispose('removed')
    await started
    expect(regisseurs.acquired.length).toBe(regisseurs.released())
    expect(leases.every((lease) => lease.revoked)).toBe(true)
    expect(terminal.spawns.length).toBe(terminal.closed.length)
  })

  it('closes the orchestrator PTY when the panel is removed, keeps it at shutdown for the restore', async () => {
    const removed = setup()
    await removed.session.start()
    removed.session.dispose('removed')
    expect(removed.terminal.closed).toEqual(['pty-1'])
    const shutdown = setup()
    await shutdown.session.start()
    shutdown.session.dispose('shutdown')
    expect(shutdown.terminal.closed).toEqual([])
  })

  it('follows the regisseur: no follow-up and its message when agence is missing', async () => {
    const { session } = setup({ regisseur: 'missing', files: { state: state(), readAt: '2026-11-17T10:00:00Z' } })
    await session.start()
    expect(snap(session).suivi).toBeNull()
    expect(snap(session).regisseur).toMatchObject({ state: 'missing', error: 'agence introuvable (agence)' })
  })

  it('publishes regisseur changes, settings hint included', async () => {
    const { session, regisseurs } = setup({ regisseur: 'starting' })
    await session.start()
    regisseurs.set({ state: 'running', settingsHint: 'réglages CLI du workspace à activer dans Cate : x' })
    expect(snap(session).regisseur).toEqual({ state: 'running', error: null, settingsHint: 'réglages CLI du workspace à activer dans Cate : x' })
  })

  it('follows the orchestrator PTY until it exits', async () => {
    const { session, terminal } = setup()
    await session.start()
    terminal.update('pty-1', { alive: false, exitCode: 0, activity: { type: 'idle' } })
    expect(snap(session).orchestrator).toBe('exited')
  })

  it('is failed with no PTY when the spawn fails', async () => {
    const { session, terminal } = setup()
    terminal.service.spawn = async () => { throw new Error('untrusted') }
    await session.start()
    expect(snap(session)).toMatchObject({ ptyId: null, orchestrator: 'failed' })
  })

  it('serves the classified follow-up, open drafts with their hash and open questions', async () => {
    const files = {
      state: state({
        needs: [need('n1', { blocking: true }), need('n2', { kind: 'draft', ref: 'd1', owner: 'heifara' })],
        drafts: [
          { id: 'd1', needId: 'n2', cible: 'pr:Heifarabuval/cate:main:feat/x', titre: 'PR', statut: 'à valider', url: null },
          { id: 'd2', needId: 'n2', cible: 'slack:C1', titre: null, statut: 'envoyé', url: null },
        ],
        questions: [
          { id: 'q1', needId: 'n3', question: 'Merger ?', options: [{ label: 'Oui', detail: 'merge' }], action: 'merge:x/y#3', answer: null },
          { id: 'q2', needId: 'n4', question: 'Déjà répondu', options: [], action: null, answer: 'non' },
        ],
      }),
      drafts: { d1: 'Texte du brouillon\n' },
      readAt: '2026-11-17T10:00:00Z',
    }
    const { session } = setup({ files })
    await session.start()
    const snapshot = snap(session)
    expect(snapshot.suivi).toMatchObject({ repo: 'cate', agentsActive: 2, readAt: '2026-11-17T10:00:00Z', error: null })
    expect(snapshot.suivi?.sections.bloquant.map((row) => row.id)).toEqual(['n1'])
    expect(snapshot.suivi?.sections.aFaire[0].action).toEqual({ type: 'draft', draftId: 'd1', inFlight: false })
    expect(snapshot.drafts).toEqual({
      d1: {
        id: 'd1', cible: 'pr:Heifarabuval/cate:main:feat/x', kind: 'pr', titre: 'PR', statut: 'à valider', texte: 'Texte du brouillon\n',
        // sha256 of 'Texte du brouillon\n'.strip() in Python.
        hash: '70538527149e9b9df5ab89f0aa826b4fc0ab807a444be890bce50dd5a47bf634',
      },
    })
    expect(snapshot.questions).toEqual({ q1: { id: 'q1', question: 'Merger ?', options: [{ label: 'Oui', detail: 'merge' }], isMerge: true } })
  })

  it('keeps the last state and shows the read error', async () => {
    const { session, files } = setup({ files: { state: state({ needs: [need('n1')] }), readAt: 't1' } })
    await session.start()
    files.set({ error: 'Unexpected end of JSON input' })
    expect(snap(session).suivi).toMatchObject({ error: 'Unexpected end of JSON input', sections: { reste: [expect.objectContaining({ id: 'n1' })] } })
  })

  it('titles linked panels from the document, remembers them, and marks a closed one', async () => {
    const linked: PanelRecord = { id: 'p1', type: 'terminal', title: 'Impl C002', fields: {} }
    const files = { state: state({ titles: { p2: 'Ancien titre CLI' }, needs: [need('n1', { panels: ['p1', 'p2', 'p3'] })] }) }
    const { session, stored } = setup({ files, others: [linked], saved: { knownTitles: { p3: 'Review fermée' } } })
    await session.start()
    expect(snap(session).suivi?.sections.reste[0].links).toEqual([
      { panelId: 'p1', title: 'Impl C002', closed: false },
      { panelId: 'p2', title: 'Ancien titre CLI', closed: true },
      { panelId: 'p3', title: 'Review fermée', closed: true },
    ])
    expect(stored()).toEqual({ knownTitles: { p1: 'Impl C002', p2: 'Ancien titre CLI', p3: 'Review fermée' } })
  })

  it('refuses to close while the orchestrator runs, with dirty, never asking', async () => {
    const { session, terminal } = setup()
    expect(session.closeBlocker()).toBeNull()
    await session.start()
    const blocker = session.closeBlocker()
    expect(isRpcError(blocker, 'dirty')).toBe(true)
    terminal.update('pty-1', { activity: { type: 'idle' } })
    expect(session.closeBlocker()).toBeNull()
  })

  describe('draft ops', () => {
    const open = { state: state({ needs: [need('n1', { kind: 'draft', ref: 'd1', owner: 'heifara' })], drafts: [{ id: 'd1', needId: 'n1', cible: 'issue:x/y', titre: 'T', statut: 'à valider', url: null }] }), drafts: { d1: 'Texte' } }
    const started = async () => {
      const setupped = setup({ files: open })
      await setupped.session.start()
      return setupped
    }
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })

    it('posts the send with the hash the view showed, and answers ok', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/draft/d1/send', form: { h: 'abc' } }])
    })

    it('posts drop and edit without a hash', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'draft.drop', draftId: 'd1' })).resolves.toEqual({ ok: true })
      await expect(op(session, { kind: 'draft.edit', draftId: 'd1' })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/draft/d1/drop', form: {} }, { path: '/draft/d1/edit', form: {} }])
    })

    it('refuses a second click on the same draft while the first is running, then accepts a new one', async () => {
      const { session, regisseurs } = await started()
      let release!: () => void
      regisseurs.answer(() => new Promise((resolve) => { release = () => resolve({ code: 200, message: 'ok' }) }))
      const first = op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toEqual({ ok: false, error: 'busy' })
      await expect(op(session, { kind: 'draft.drop', draftId: 'd1' })).resolves.toEqual({ ok: false, error: 'busy' })
      expect(regisseurs.posts).toHaveLength(1)
      release()
      await expect(first).resolves.toEqual({ ok: true })
      regisseurs.answer(async () => ({ code: 200, message: 'ok' }))
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toEqual({ ok: true })
    })

    it.each(['texte a changé', 'déjà « envoyer »', 'besoin clos'])('renders the regisseur\'s 409 (%s) as a conflict with its message', async (message) => {
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => ({ code: 409, message }))
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toEqual({ ok: false, error: 'conflict', message })
    })

    it('renders an invalid token as unavailable, not as a conflict', async () => {
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => ({ code: 403, message: 'Jeton invalide' }))
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toEqual({ ok: false, error: 'unavailable', message: 'Jeton invalide' })
    })

    it.each(['external', 'missing', 'stopped', 'starting'] as const)('is unavailable when the regisseur is %s, posting nothing', async (regisseur) => {
      const { session, regisseurs } = setup({ files: open, regisseur })
      await session.start()
      await expect(op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
      expect(regisseurs.posts).toEqual([])
    })

    it('is unavailable when the post itself fails', async () => {
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => { throw new Error('regisseur-unavailable') })
      await expect(op(session, { kind: 'draft.edit', draftId: 'd1' })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
    })

    it('refuses a draft that is not open, posting nothing', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'draft.send', draftId: 'd9', hash: 'abc' })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(op(session, { kind: 'draft.send', draftId: '../x', hash: 'abc' })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it('exposes no cate api and writes no file', async () => {
      const { session } = await started()
      expect(session.handleApi).toBeUndefined()
      const source = readFileSync(path.join(__dirname, 'session.ts'), 'utf8')
      expect(source).not.toMatch(/writeFile|appendFile|rename|mkdir|unlink|createWriteStream|rmSync|copyFile/)
    })
  })
})
