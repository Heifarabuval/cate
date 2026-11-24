import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '@kernel/log/contract'
import { isRpcError } from '@kernel/rpc/contract'
import { createDocument, type Json, type PanelRecord, type WorkspaceDocument } from '@workspace/document/contract'
import { TERMINAL_RESTORE_LAUNCH, type SpawnParams, type TerminalStatus, type TerminalStatusChange } from '@services/terminal/contract'
import type { SessionKit } from '@panels/framework/runtime'
import type { AgenceOp, AgenceSnapshot, AgenceState, PratiquesView, RegisseurView } from './contract'
import { AgenceSession, type AgenceSessionDeps } from './session'
import { createRegisseurs, type RegisseurAcquire, type RegisseurHandle, type Regisseurs } from './parts/runtime/regisseur'
import type { StateFilesRead } from './parts/runtime/stateFiles'

/** The form view the regisseur publishes (spec 008, lot 1): its fixture is the contract. */
const vueReglages = JSON.parse(readFileSync(path.join(__dirname, 'contract', 'fixtures', 'vue-reglages.json'), 'utf8')) as Required<Pick<PratiquesView, 'champs' | 'presets' | 'invariants'>>

// macOS arm64 uniquement (le régisseur est un processus POSIX)
const itPosix = it.skipIf(process.platform === 'win32')

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
  const posts: Array<{ path: string; form: Record<string, string | string[]> }> = []
  let released = 0
  let restarts = 0
  let view: RegisseurView = { state: initial, error: initial === 'missing' ? 'agence introuvable (agence)' : null, settingsHint: null }
  const listeners = new Set<(view: RegisseurView) => void>()
  /** What the next posts answer; a function can hold the answer back. */
  let answer: (path: string, form: Record<string, string | string[]>) => Promise<{ code: number; message: string }> = async () => ({ code: 200, message: 'ok' })
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
          restart() {
            if (view.state === 'running' || view.state === 'starting') return false
            restarts++
            return true
          },
          release() { if (!done) { done = true; released++ } },
        }
      },
    },
    acquired,
    posts,
    released: () => released,
    restarts: () => restarts,
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
  evidence: null, status: 'open', closeFailed: false, agentBlocked: false,
  updated: '2026-11-17T10:00:00+00:00', ...patch,
})
const state = (patch: Partial<AgenceState> = {}): AgenceState => ({
  repo: 'cate', ghRepo: null, agentsActive: 2, port: 4321, panels: {}, titles: {}, needs: [], drafts: [], questions: [], ...patch,
} as AgenceState)

function setup(options: { saved?: Json; regisseur?: RegisseurView['state']; files?: Partial<StateFilesRead>; others?: PanelRecord[]; fields?: Record<string, Json> } = {}) {
  const terminal = fakeTerminal()
  const regisseurs = fakeRegisseurs(options.regisseur)
  // A state read by default: the regisseur's first turn, which the launch waits for.
  const files = fakeFiles(options.files ?? { state: state(), readAt: 't' })
  const k = fakeKit(record(options.fields), options.saved, options.others)
  const deps: AgenceSessionDeps = {
    root: '/repo',
    terminal: terminal.service,
    regisseurs: regisseurs.regisseurs,
    files: files.files,
  }
  const session = new AgenceSession(k.kit, record(options.fields), deps)
  return { session, terminal, regisseurs, files, ...k }
}

const snap = (session: AgenceSession): AgenceSnapshot => session.snapshot()

describe('AgenceSession', () => {
  it('does nothing until start: no PTY, no regisseur, no file watch', () => {
    const { terminal, regisseurs, files } = setup()
    expect(terminal.spawns).toEqual([])
    expect(regisseurs.acquired).toEqual([])
    expect(files.dirs).toEqual([])
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

  itPosix('works in the record\'s root when it has one', async () => {
    const { session, terminal, regisseurs, files } = setup({ fields: { root: '/other' } })
    await session.start()
    expect(terminal.spawns[0].cwd).toBe('/other')
    expect(regisseurs.acquired[0].root).toBe('/other')
    expect(files.dirs).toEqual(['/other/.cate/tmp/agence'])
  })

  it('takes a regisseur reference in its name at start, and gives it back at dispose (the CLI lease is the regisseur\'s)', async () => {
    const { session, regisseurs, files } = setup({ files: { state: state({ port: 4321 }) } })
    await session.start()
    expect(regisseurs.acquired).toEqual([expect.objectContaining({ root: '/repo', panelId: 'ag1' })])
    expect(regisseurs.acquired[0].port()).toBe(4321)
    expect(snap(session).regisseur).toEqual({ state: 'running', error: null, settingsHint: null })
    session.dispose('removed')
    expect(regisseurs.released()).toBe(1)
    expect(files.disposed()).toBe(1)
  })

  it('gives everything back when it is disposed while starting', async () => {
    const { session, regisseurs, terminal } = setup()
    const started = session.start()
    session.dispose('removed')
    await started
    expect(regisseurs.acquired.length).toBe(regisseurs.released())
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

  it('serves the send guard the regisseur wrote, inconnu before its first turn', async () => {
    const { session, files } = setup({ files: { state: state(), readAt: 't' } })
    expect(snap(session).garde).toBe('inconnu')
    await session.start()
    expect(snap(session).garde).toBe('inconnu')
    for (const garde of ['actif', 'inactif', 'partiel'] as const) {
      files.set({ state: state({ garde }) })
      expect(snap(session).garde).toBe(garde)
    }
    files.set({ state: state({ garde: 'autre' as never }) })
    expect(snap(session).garde).toBe('inconnu')
  })

  it('says the send guard is unknown when agence is missing', async () => {
    const { session } = setup({ regisseur: 'missing', files: { state: state({ garde: 'actif' }), readAt: 't' } })
    await session.start()
    expect(snap(session).garde).toBe('inconnu')
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

  it('marks the option of a regisseur card whose click is gone as already taken (issue 202)', async () => {
    const options = [{ label: 'Éclairer F1', detail: 'a' }, { label: 'Éclairer F2', detail: 'b' }, { label: 'Vu', detail: '' }]
    const { session } = setup({ files: { state: state({ questions: [
      { id: 'q1', needId: 'n1', question: 'Éclairer ?', options, action: null, answer: null, clics: [null, '/lentille/F2/eclairer', ''] },
      { id: 'q2', needId: 'n2', question: 'Sans clics', options, action: null, answer: null },
    ] }) } })
    await session.start()
    expect(snap(session).questions.q1.options).toEqual([{ ...options[0], fait: true }, options[1], options[2]])
    expect(snap(session).questions.q2.options).toEqual(options)
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
    expect(snapshot.questions).toEqual({ q1: { id: 'q1', question: 'Merger ?', options: [{ label: 'Oui', detail: 'merge' }], isMerge: true, locks: [], ghUnknown: true, rebase: false } })
  })

  it("serves the human's name from the state, « L'humain » for an old state without one", async () => {
    const named = setup({ files: { state: state({ humain: 'Max' }), readAt: 't' } })
    await named.session.start()
    expect(snap(named.session).suivi?.humain).toBe('Max')
    const old = setup({ files: { state: state(), readAt: 't' } })
    await old.session.start()
    expect(snap(old.session).suivi?.humain).toBe("L'humain")
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

  describe('pratiques', () => {
    const pratiques = {
      preset: 'pr-tdd',
      valeurs: { 'livraison.methode': 'squash', 'livraison.merge': 'clic', preuve: ['pr-mergee', 'ci-verte'] },
      sources: { preset: 'dev', 'livraison.methode': 'projet', 'livraison.merge': 'défaut', preuve: 'dev' },
      erreur: null,
    }
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })
    let root: string
    beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'agence-pratiques-')) })
    afterEach(() => { rmSync(root, { recursive: true, force: true }) })
    const file = () => path.join(root, '.cate', 'tmp', 'agence', 'pratiques.json')

    it('serves the policy the CLI published: values, sources, error', async () => {
      const { session, files } = setup({ files: { state: state({ pratiques } as Partial<AgenceState>), readAt: 't' } })
      expect(snap(session).pratiques).toBeNull()
      await session.start()
      expect(snap(session).pratiques).toEqual(pratiques)
      files.set({ state: state({ pratiques: { ...pratiques, erreur: 'pratiques.json : clé inconnue « foo »' } } as Partial<AgenceState>) })
      expect(snap(session).pratiques?.erreur).toBe('pratiques.json : clé inconnue « foo »')
    })

    it('serves null when the state has no policy (old CLI) or agence is missing', async () => {
      const old = setup({ files: { state: state(), readAt: 't' } })
      await old.session.start()
      expect(snap(old.session).pratiques).toBeNull()
      const missing = setup({ regisseur: 'missing', files: { state: state({ pratiques } as Partial<AgenceState>), readAt: 't' } })
      await missing.session.start()
      expect(snap(missing.session).pratiques).toBeNull()
    })

    it('ignores a policy of the wrong shape', async () => {
      const { session } = setup({ files: { state: state({ pratiques: { preset: 3 } } as unknown as Partial<AgenceState>), readAt: 't' } })
      await session.start()
      expect(snap(session).pratiques).toBeNull()
    })

    it('puts the published merge method on each merge question only', async () => {
      const questions = [
        { id: 'q1', needId: 'n3', question: 'Merger ?', options: [{ label: 'Merger', detail: '' }], action: 'merge:x/y#3', answer: null },
        { id: 'q2', needId: 'n4', question: 'Autre ?', options: [], action: null, answer: null },
      ]
      const { session } = setup({ files: { state: state({ pratiques, questions } as Partial<AgenceState>), readAt: 't' } })
      await session.start()
      expect(snap(session).questions.q1.methode).toBe('squash')
      expect(snap(session).questions.q2.methode).toBeUndefined()
    })

    // The published form view (spec 008, lot 1): the contract is the regisseur's fixture.
    const reglages = { ...vueReglages, valeurs: { 'agents.max': 2 }, sources: { preset: 'défaut', 'agents.max': 'projet' } }
    const withForm = (patch: Record<string, unknown> = {}) => setup({ files: { state: state({ pratiques: { ...reglages, ...patch } } as unknown as Partial<AgenceState>), readAt: 't' } })

    it('keeps the form view the regisseur published: fields, presets, project file, its count, invariants', async () => {
      const { session } = withForm()
      await session.start()
      const view = snap(session).pratiques!
      expect(view.champs).toEqual(vueReglages.champs)
      expect(view.presets).toEqual(vueReglages.presets)
      expect(view).toMatchObject({ projet: true, nbProjet: 1, invariants: vueReglages.invariants })
    })

    it('serves a policy without the form view as before (old CLI): no field, no error', async () => {
      const { session } = setup({ files: { state: state({ pratiques } as Partial<AgenceState>), readAt: 't' } })
      await session.start()
      const view = snap(session).pratiques!
      expect(view).toEqual(pratiques)
      expect(view.champs).toBeUndefined()
      expect(view.projet).toBeUndefined()
    })

    it('drops a field of the wrong shape and keeps the others', async () => {
      const { session } = withForm({ champs: [{ cle: 3 }, ...vueReglages.champs.slice(0, 2)] })
      await session.start()
      expect(snap(session).pratiques!.champs!.map((champ) => champ.cle)).toEqual(
        vueReglages.champs.slice(0, 2).map((champ) => champ.cle),
      )
    })

    it('pratique.set posts the key and its value as JSON to /pratiques/set', async () => {
      const { session, regisseurs } = withForm()
      await session.start()
      await expect(op(session, { kind: 'pratique.set', cle: 'agents.max', valeur: 3 })).resolves.toEqual({ ok: true })
      await expect(op(session, { kind: 'pratique.set', cle: 'preuve', valeur: ['ci-verte', 'rapport'] })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([
        { path: '/pratiques/set', form: { cle: 'agents.max', valeur: '3' } },
        { path: '/pratiques/set', form: { cle: 'preuve', valeur: '["ci-verte","rapport"]' } },
      ])
    })

    it('pratique.unset and pratique.preset post to their routes, remplacer only when asked', async () => {
      const { session, regisseurs } = withForm()
      await session.start()
      await op(session, { kind: 'pratique.unset', cle: 'agents.max' })
      await op(session, { kind: 'pratique.preset', nom: 'pr-tdd' })
      await op(session, { kind: 'pratique.preset', nom: 'pr-tdd', remplacer: true })
      expect(regisseurs.posts).toEqual([
        { path: '/pratiques/unset', form: { cle: 'agents.max' } },
        { path: '/pratiques/preset', form: { nom: 'pr-tdd' } },
        { path: '/pratiques/preset', form: { nom: 'pr-tdd', remplacer: '1' } },
      ])
    })

    it('refuses a key or a preset the regisseur did not publish, without posting', async () => {
      const { session, regisseurs } = withForm()
      await session.start()
      await expect(op(session, { kind: 'pratique.set', cle: 'inconnue', valeur: 1 })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(op(session, { kind: 'pratique.unset', cle: 'inconnue' })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(op(session, { kind: 'pratique.preset', nom: 'inconnu' })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it('answers invalid with the regisseur\'s plain phrase on a 400', async () => {
      const { session, regisseurs } = withForm()
      await session.start()
      regisseurs.answer(async () => ({ code: 400, message: 'Agents en même temps : entre 1 et 16.' }))
      await expect(op(session, { kind: 'pratique.set', cle: 'agents.max', valeur: 40 }))
        .resolves.toEqual({ ok: false, error: 'invalid', message: 'Agents en même temps : entre 1 et 16.' })
    })

    it('answers unavailable and posts nothing when the regisseur is stopped', async () => {
      const { session, regisseurs } = withForm()
      await session.start()
      regisseurs.set({ state: 'stopped' })
      await expect(op(session, { kind: 'pratique.set', cle: 'agents.max', valeur: 3 })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
      expect(regisseurs.posts).toEqual([])
    })

    it('has no openPratiques op any more, and writes no file', async () => {
      const { session } = setup({ fields: { root }, files: { state: state({ pratiques } as Partial<AgenceState>), readAt: 't' } })
      await session.start()
      await expect(op(session, { kind: 'openPratiques' } as unknown as AgenceOp)).rejects.toThrow()
      expect(existsSync(file())).toBe(false)
    })
  })

  describe('first questions (spec 008, lot 4)', () => {
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })
    const policy = (patch: Record<string, unknown> = {}) => ({ ...vueReglages, valeurs: {}, sources: { preset: 'défaut' }, ...patch })
    const withPolicy = (patch: Record<string, unknown>, options: Parameters<typeof setup>[0] = {}) =>
      setup({ ...options, files: { state: state({ pratiques: policy(patch) } as unknown as Partial<AgenceState>), readAt: 't' } })

    it('starts the regisseur but not the orchestrator while the project has no settings file', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      expect(regisseurs.acquired).toHaveLength(1)
      expect(terminal.spawns).toEqual([])
      expect(snap(session).pratiques?.projet).toBe(false)
    })

    it('writes every answer in one POST, then starts the orchestrator', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      await expect(op(session, { kind: 'pratique.questions', reponses: { 'livraison.mode': 'main', 'agents.max': 2 } })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/pratiques/set', form: { cle: ['livraison.mode', 'agents.max'], valeur: ['"main"', '2'] } }])
      expect(terminal.spawns).toEqual([expect.objectContaining({ launch: { kind: 'agents.start', params: { agentId: 'claude-code', prompt: '/orchestrateur' } } })])
    })

    it('« Passer » writes the default preset, then starts the orchestrator', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      await expect(op(session, { kind: 'pratique.questions', passer: true })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/pratiques/preset', form: { nom: 'neutre' } }])
      expect(terminal.spawns).toHaveLength(1)
    })

    it('starts nothing when the regisseur refuses the answers', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      regisseurs.answer(async () => ({ code: 400, message: 'Agents en même temps : entre 1 et 16.' }))
      await expect(op(session, { kind: 'pratique.questions', reponses: { 'agents.max': 40 } })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(terminal.spawns).toEqual([])
    })

    it('refuses an answer to a key the regisseur did not publish, without posting', async () => {
      const { session, regisseurs } = withPolicy({ projet: false })
      await session.start()
      await expect(op(session, { kind: 'pratique.questions', reponses: { inconnue: 1 } })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it('launches at once when the project has its file, or when the CLI says nothing of it', async () => {
      const done = withPolicy({ projet: true })
      await done.session.start()
      expect(done.terminal.spawns).toHaveLength(1)
      const old = setup({ files: { state: state({ pratiques: { preset: 'neutre', valeurs: {}, sources: {}, erreur: null } } as Partial<AgenceState>), readAt: 't' } })
      await old.session.start()
      expect(old.terminal.spawns).toHaveLength(1)
    })

    it('a second answer after the end has no effect: no POST, no second orchestrator', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      await op(session, { kind: 'pratique.questions', passer: true })
      await expect(op(session, { kind: 'pratique.questions', reponses: { 'agents.max': 3 } })).resolves.toMatchObject({ ok: false, error: 'conflict' })
      expect(regisseurs.posts).toHaveLength(1)
      expect(terminal.spawns).toHaveLength(1)
    })

    it('answers the questions published after the orchestrator already started (workspace opened before the feature)', async () => {
      const old = { preset: 'neutre', valeurs: {}, sources: {}, erreur: null }
      const { session, terminal, regisseurs, files } = setup({ files: { state: state({ pratiques: old } as Partial<AgenceState>), readAt: 't' } })
      await session.start()
      expect(terminal.spawns).toHaveLength(1)
      files.set({ state: state({ pratiques: policy({ projet: false }) } as unknown as Partial<AgenceState>), readAt: 't2' })
      await expect(op(session, { kind: 'pratique.questions', passer: true })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/pratiques/preset', form: { nom: 'neutre' } }])
      expect(terminal.spawns).toHaveLength(1)
      await expect(op(session, { kind: 'pratique.questions', passer: true })).resolves.toMatchObject({ ok: false, error: 'conflict' })
    })

    it('starts the orchestrator when another client answered (the file now exists)', async () => {
      const { session, terminal, files } = withPolicy({ projet: false })
      await session.start()
      files.set({ state: state({ pratiques: policy({ projet: true }) } as unknown as Partial<AgenceState>) })
      await vi.waitFor(() => expect(terminal.spawns).toHaveLength(1))
      files.set({ state: state({ pratiques: policy({ projet: true, nbProjet: 2 }) } as unknown as Partial<AgenceState>) })
      expect(terminal.spawns).toHaveLength(1)
    })

    it('waits for the regisseur\'s first state before deciding, then asks', async () => {
      const { session, terminal, files } = setup({ files: { state: null } })
      await session.start()
      expect(terminal.spawns).toEqual([])
      files.set({ state: state({ pratiques: policy({ projet: false }) } as unknown as Partial<AgenceState>), readAt: 't' })
      expect(terminal.spawns).toEqual([])
      files.set({ state: state({ pratiques: policy({ projet: true }) } as unknown as Partial<AgenceState>) })
      await vi.waitFor(() => expect(terminal.spawns).toHaveLength(1))
    })

    it('writes nothing without the regisseur, and the restart op brings it back with the orchestrator still held', async () => {
      const { session, terminal, regisseurs } = withPolicy({ projet: false })
      await session.start()
      regisseurs.set({ state: 'stopped', error: null })
      await expect(op(session, { kind: 'pratique.questions', passer: true })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
      await expect(op(session, { kind: 'orchestrator.restart' })).resolves.toEqual({ ok: true })
      expect(regisseurs.restarts()).toBe(1)
      expect(regisseurs.posts).toEqual([])
      expect(terminal.spawns).toEqual([])
    })

    it('launches as before when agence is missing', async () => {
      const { session, terminal } = setup({ regisseur: 'missing' })
      await session.start()
      expect(terminal.spawns).toHaveLength(1)
    })
  })

  describe('orchestrator.restart', () => {
    const restart = (session: AgenceSession) => session.handleOp({ kind: 'orchestrator.restart' }, { clientId: 'c1', connectionId: 1 })

    it('is busy while the orchestrator and the regisseur both run', async () => {
      const { session, terminal, regisseurs } = setup()
      await session.start()
      await expect(restart(session)).resolves.toEqual({ ok: false, error: 'busy' })
      expect(terminal.spawns).toHaveLength(1)
      expect(regisseurs.restarts()).toBe(0)
    })

    it('resumes an exited orchestrator in a new PTY, closing the old one', async () => {
      const { session, terminal } = setup()
      await session.start()
      terminal.update('pty-1', { alive: false, exitCode: 0, activity: { type: 'idle' } })
      await expect(restart(session)).resolves.toEqual({ ok: true })
      expect(terminal.spawns[1]).toMatchObject({ panelId: 'ag1', launch: TERMINAL_RESTORE_LAUNCH, restore: true })
      expect(terminal.closed).toEqual(['pty-1'])
      expect(snap(session)).toMatchObject({ ptyId: 'pty-2', orchestrator: 'running' })
    })

    it('restarts a regisseur that stopped, leaving a running orchestrator alone', async () => {
      const { session, terminal, regisseurs } = setup()
      await session.start()
      regisseurs.set({ state: 'stopped', error: "agence watch s'est arrêté (SIGKILL)" })
      expect(snap(session).regisseur).toMatchObject({ state: 'stopped', error: "agence watch s'est arrêté (SIGKILL)" })
      await expect(restart(session)).resolves.toEqual({ ok: true })
      expect(regisseurs.restarts()).toBe(1)
      expect(terminal.spawns).toHaveLength(1)
    })
  })

  describe('answer', () => {
    const merge = (gh: Record<string, unknown> | null) => ({
      id: 'q1', needId: 'n9', question: 'Merger la 12 ?', options: [{ label: 'Merger (rebase)', detail: '' }, { label: 'Non', detail: '' }],
      action: 'merge:x/y#12', answer: null, ...(gh ? { gh } : {}),
    })
    const started = async (questions: AgenceState['questions'] = [merge(null)]) => {
      const setupped = setup({ files: { state: state({ ghRepo: 'x/y', needs: [need('n9', { kind: 'human', ref: 'q1', owner: 'heifara' })], questions }) } })
      await setupped.session.start()
      return setupped
    }
    const answer = (session: AgenceSession, op: Omit<Extract<AgenceOp, { kind: 'answer' }>, 'kind'>) =>
      session.handleOp({ kind: 'answer', ...op }, { clientId: 'c1', connectionId: 1 })

    it('posts the choice, the free answer, the rebase and the forced merge to /ask/<id>', async () => {
      const { session, regisseurs } = await started()
      await expect(answer(session, { questionId: 'q1', choice: 1 })).resolves.toEqual({ ok: true })
      await expect(answer(session, { questionId: 'q1', libre: 'plus tard' })).resolves.toEqual({ ok: true })
      await expect(answer(session, { questionId: 'q1', choice: 'rebase' })).resolves.toEqual({ ok: true })
      await expect(answer(session, { questionId: 'q1', choice: 0, force: true })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([
        { path: '/ask/q1', form: { choice: '1' } },
        { path: '/ask/q1', form: { libre: 'plus tard' } },
        { path: '/ask/q1', form: { choice: 'rebase' } },
        { path: '/ask/q1', form: { choice: '0', force: '1' } },
      ])
    })

    it('lets the free answer win over a choice: only the text is posted', async () => {
      const { session, regisseurs } = await started()
      await expect(answer(session, { questionId: 'q1', choice: 0, libre: 'plus tard' })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/ask/q1', form: { libre: 'plus tard' } }])
    })

    it('renders « Question déjà répondue. » as a conflict', async () => {
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => ({ code: 409, message: 'Question déjà répondue.' }))
      await expect(answer(session, { questionId: 'q1', choice: 1 })).resolves.toEqual({ ok: false, error: 'conflict', message: 'Question déjà répondue.' })
    })

    it('renders a greyed merge (409) as a conflict, a missing choice (400) as invalid', async () => {
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => ({ code: 409, message: 'Merge grisé : conflit avec la base (« Merger quand même » pour passer outre).' }))
      await expect(answer(session, { questionId: 'q1', choice: 0 })).resolves.toMatchObject({ ok: false, error: 'conflict', message: expect.stringMatching(/Merge grisé/) })
      regisseurs.answer(async () => ({ code: 400, message: 'Choix manquant.' }))
      await expect(answer(session, { questionId: 'q1' })).resolves.toEqual({ ok: false, error: 'invalid', message: 'Choix manquant.' })
    })

    it('refuses an answered or unknown question, posting nothing', async () => {
      const { session, regisseurs } = await started([{ ...merge(null), answer: 'Non' }])
      await expect(answer(session, { questionId: 'q1', choice: 0 })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(answer(session, { questionId: '../q', choice: 0 })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it('shows why Merger is greyed and offers the rebase on a fresh conflict', async () => {
      const { session } = await started([merge({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', ts: Date.now() / 1000 })])
      expect(snap(session).questions.q1).toMatchObject({ isMerge: true, locks: ['conflit avec la base'], ghUnknown: false, rebase: true })
      expect(snap(session).suivi?.sections.aFaire[0]).toMatchObject({ meta: ['Merger grisé : conflit avec la base'], action: { type: 'question', questionId: 'q1', rebase: true } })
    })
  })

  describe('offers of the regisseur (issue 207)', () => {
    const started = async (patch: Record<string, unknown>) => {
      const setupped = setup({ files: { state: state({ needs: [need('n3', patch)] }) } })
      await setupped.session.start()
      return setupped
    }
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })
    const worktree = { worktree: { path: '/x/n2-impl', branch: 'fix/x' } }
    const orphan = { orphan: { panel: 'p9', title: 'T' } }

    it.each(['remove', 'keep'] as const)('posts the worktree choice %s to /wt/<needId>/%s', async (choix) => {
      const { session, regisseurs } = await started(worktree)
      await expect(op(session, { kind: 'worktree', needId: 'n3', choix })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: `/wt/n3/${choix}`, form: {} }])
    })

    it.each(['close', 'keep'] as const)('posts the orphan choice %s to /orphan/<needId>/%s', async (choix) => {
      const { session, regisseurs } = await started(orphan)
      await expect(op(session, { kind: 'orphan', needId: 'n3', choix })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: `/orphan/n3/${choix}`, form: {} }])
    })

    it.each([
      ['a worktree op on a need that offers none', { kind: 'worktree', needId: 'n3', choix: 'remove' }, orphan],
      ['an orphan op on a need that offers none', { kind: 'orphan', needId: 'n3', choix: 'close' }, worktree],
      ['a closed need', { kind: 'worktree', needId: 'n3', choix: 'remove' }, { ...worktree, status: 'done' }],
      ['an unknown choice', { kind: 'worktree', needId: 'n3', choix: 'close' }, worktree],
      ['an id outside ^n\\d+$', { kind: 'worktree', needId: '../n3', choix: 'remove' }, worktree],
    ])('refuses %s as invalid, posting nothing', async (_name, value, needPatch) => {
      const { session, regisseurs } = await started(needPatch)
      await expect(op(session, value as AgenceOp)).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it("renders the regisseur's refusal (409) with its message", async () => {
      const { session, regisseurs } = await started(worktree)
      const message = 'Le worktree a changé : rien supprimé.'
      regisseurs.answer(async () => ({ code: 409, message }))
      await expect(op(session, { kind: 'worktree', needId: 'n3', choix: 'remove' })).resolves.toEqual({ ok: false, error: 'conflict', message })
    })
  })

  describe('perm', () => {
    const perm = (patch: Record<string, unknown> = {}) => ({ genre: 'hook', commande: 'rm -rf build', motif: 'nettoyage', choix: ['oui', 'non'], panel: 'p1', ...patch })
    const started = async (patch: Record<string, unknown> = {}) => {
      const setupped = setup({ files: { state: state({ needs: [need('n3', { agentBlocked: true, panels: ['p1'], perm: perm(), ...patch })] }) } })
      await setupped.session.start()
      return setupped
    }
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })

    it.each(['oui', 'non'] as const)('posts %s to /perm/<needId>/%s, the same click as the sends', async (reponse) => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'perm', needId: 'n3', reponse })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: `/perm/n3/${reponse}`, form: {} }])
    })

    it.each([
      ['an id outside ^n\\d+$', { needId: '../n3' }, {}],
      ['an unknown need', { needId: 'n9' }, {}],
      ['a closed need', {}, { status: 'done' }],
      ['a need whose screen has no Oui/Non', {}, { perm: perm({ choix: [] }) }],
      ['a need with no perm', {}, { perm: null }],
    ])('refuses %s as invalid, posting nothing', async (_name, opPatch, needPatch) => {
      const { session, regisseurs } = await started(needPatch)
      await expect(op(session, { kind: 'perm', needId: 'n3', reponse: 'oui', ...opPatch })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it('refuses a reply that is neither oui nor non', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'perm', needId: 'n3', reponse: 'peut-etre' as 'oui' })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it("renders the regisseur's refusal (409) as a conflict with its message", async () => {
      const { session, regisseurs } = await started()
      const message = 'La demande a changé ou disparu : recharge le suivi, relis, puis réponds.'
      regisseurs.answer(async () => ({ code: 409, message }))
      await expect(op(session, { kind: 'perm', needId: 'n3', reponse: 'oui' })).resolves.toEqual({ ok: false, error: 'conflict', message })
    })

    it('answers unavailable when the regisseur is not running', async () => {
      const { session, regisseurs } = await started()
      regisseurs.set({ state: 'stopped' })
      await expect(op(session, { kind: 'perm', needId: 'n3', reponse: 'oui' })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
      expect(regisseurs.posts).toEqual([])
    })
  })

  describe('backlog', () => {
    // The contract of lot 4: the `backlog` field the regisseur publishes in its state.
    const published = JSON.parse(readFileSync(path.join(__dirname, 'contract', 'fixtures', 'vue-backlog.json'), 'utf8')).backlog
    const withBacklog = (backlog: unknown = published) => ({ state: state({ backlog } as Partial<AgenceState>), readAt: 't' })
    const op = (session: AgenceSession, value: AgenceOp) => session.handleOp(value, { clientId: 'c1', connectionId: 1 })
    const started = async (backlog?: unknown) => {
      const setupped = setup({ files: withBacklog(backlog) })
      await setupped.session.start()
      return setupped
    }

    it('serves the backlog the regisseur published: fiches, vagues, attentes, erreur', async () => {
      const { session } = await started()
      expect(snap(session).backlog).toEqual(published)
    })

    it('serves the file error the regisseur published', async () => {
      const { session } = await started({ fiches: [], vagues: [], attentes: {}, enFile: [], erreur: 'backlog.json : F2 : etat invalide' })
      expect(snap(session).backlog).toEqual({ fiches: [], vagues: [], attentes: {}, enFile: [], erreur: 'backlog.json : F2 : etat invalide' })
    })

    it('serves null without a backlog (old CLI), with a wrong shape, or when agence is missing', async () => {
      const old = setup({ files: { state: state(), readAt: 't' } })
      await old.session.start()
      expect(snap(old.session).backlog).toBeNull()
      const wrong = await started({ fiches: 'F1' })
      expect(snap(wrong.session).backlog).toBeNull()
      const missing = setup({ regisseur: 'missing', files: withBacklog() })
      await missing.session.start()
      expect(snap(missing.session).backlog).toBeNull()
    })

    it('drops a fiche of the wrong shape and keeps the unknown consumption unknown, never 0', async () => {
      const { session } = await started({ ...published, fiches: [{ id: 'F1', titre: 'Sans état' }, { id: 'F9', titre: 'Sans mesure', etat: 'lancée', priorite: 'P1', budgetJetons: 100 }] })
      expect(snap(session).backlog?.fiches).toEqual([{ id: 'F9', titre: 'Sans mesure', etat: 'lancée', priorite: 'P1', consomme: null }])
    })

    it('fiches.lancer answers ok on the reply the CLI really sends for a success', async () => {
      // Captured from a real `agence watch` by tools/agence/test_lancer.py (RouteReelle).
      const reply = JSON.parse(readFileSync(path.join(__dirname, 'contract', 'fixtures', 'reponse-lancer.json'), 'utf8')).body
      const { session, regisseurs } = await started()
      regisseurs.answer(async () => reply)
      await expect(op(session, { kind: 'fiches.lancer', ids: ['F1'] })).resolves.toEqual({ ok: true })
    })

    it('fiches.lancer posts /fiches/lancer with the ids, and answers ok', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'fiches.lancer', ids: ['F2', 'F5'] })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/fiches/lancer', form: { ids: 'F2,F5' } }])
    })

    it('refuses an id out of SAFE_ID or no id at all, posting nothing', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'fiches.lancer', ids: ['F2', '../x'] })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(op(session, { kind: 'fiches.lancer', ids: ['F2,F3'] })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      await expect(op(session, { kind: 'fiches.lancer', ids: [] })).resolves.toMatchObject({ ok: false, error: 'invalid' })
      expect(regisseurs.posts).toEqual([])
    })

    it("renders the regisseur's refusal (409, a second click) as a conflict with its message", async () => {
      const { session, regisseurs } = await started()
      const message = 'F2 n\'est plus prête : rien lancé.'
      regisseurs.answer(async () => ({ code: 409, message }))
      await expect(op(session, { kind: 'fiches.lancer', ids: ['F2'] })).resolves.toEqual({ ok: false, error: 'conflict', message })
    })
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

    it('serves an incertain slack draft as incertain, and posts confirme=1 only when the op carries it', async () => {
      const files = { state: state({ needs: [need('n1', { kind: 'draft', ref: 'd1', owner: 'heifara' })], drafts: [{ id: 'd1', needId: 'n1', cible: 'slack:C1', titre: null, statut: 'à valider', url: null, incertain: true }] }), drafts: { d1: 'Salut' } }
      const { session, regisseurs } = setup({ files })
      await session.start()
      expect(snap(session).drafts.d1.incertain).toBe(true)
      await op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc' })
      await op(session, { kind: 'draft.send', draftId: 'd1', hash: 'abc', confirme: true })
      expect(regisseurs.posts).toEqual([{ path: '/draft/d1/send', form: { h: 'abc' } }, { path: '/draft/d1/send', form: { h: 'abc', confirme: '1' } }])
    })

    it('posts drop and edit without a hash', async () => {
      const { session, regisseurs } = await started()
      await expect(op(session, { kind: 'draft.drop', draftId: 'd1' })).resolves.toEqual({ ok: true })
      await expect(op(session, { kind: 'draft.edit', draftId: 'd1' })).resolves.toEqual({ ok: true })
      expect(regisseurs.posts).toEqual([{ path: '/draft/d1/drop', form: {} }, { path: '/draft/d1/edit', form: {} }])
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

  describe('linked panel titles', () => {
    it('never shows an empty title: a panel with none known anywhere is not linked', async () => {
      const blank: PanelRecord = { id: 'p5', type: 'terminal', title: '', fields: {} }
      const files = { state: state({ needs: [need('n1', { panels: ['p5', 'p6'] })] }) }
      const { session } = setup({ files, others: [blank] })
      await session.start()
      expect(snap(session).suivi?.sections.reste[0].links).toEqual([])
      expect(snap(session).suivi?.sections.reste[0].meta).toEqual([])
    })

    it('follows a rename and keeps the last title once the panel is gone', async () => {
      const linked: PanelRecord = { id: 'p1', type: 'terminal', title: 'Impl C002', fields: {} }
      const files = { state: state({ needs: [need('n1', { panels: ['p1'] })] }) }
      const first = setup({ files, others: [linked] })
      await first.session.start()
      expect(first.stored()).toEqual({ knownTitles: { p1: 'Impl C002' } })
      // Next start: the panel was closed meanwhile.
      const next = setup({ files, saved: first.stored() })
      await next.session.start()
      expect(snap(next.session).suivi?.sections.reste[0].links).toEqual([{ panelId: 'p1', title: 'Impl C002', closed: true }])
    })
  })

  describe('with the real regisseur registry', () => {
    const FAKE = path.join(__dirname, 'parts', 'runtime', 'fixtures', 'fake-agence.mjs')
    let tmp: string
    let logFile: string
    let port: number
    let registry: Regisseurs
    const trust = { isTrusted: () => true, requireTrusted() {}, onChange: () => () => {} }
    const ofKind = (event: string) => {
      try { return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { event: string }).filter((entry) => entry.event === event) } catch { return [] }
    }
    const makeRegistry = () => createRegisseurs({
      command: process.execPath,
      commandArgs: [FAKE],
      trust,
      cliEnv: async (panelId) => ({ env: { PATH: process.env.PATH ?? '', FAKE_AGENCE_LOG: logFile, FAKE_AGENCE_PORT: String(port), CATE_TOKEN: `tok-${panelId}` }, revoke() {} }),
    })
    /** A session of panel `panelId` on the shared registry, its follow-up already readable. */
    const open = (panelId: string, saved?: Json) => {
      const panel = { ...record(), id: panelId }
      const k = fakeKit(panel, saved)
      const terminal = fakeTerminal()
      const files = fakeFiles({ state: state({ port, needs: [need('n1')] }), readAt: 't' })
      const session = new AgenceSession(k.kit, panel, { root: tmp, terminal: terminal.service, regisseurs: registry, files: files.files })
      return { session, terminal }
    }

    beforeEach(async () => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'cate-agence-session-'))
      logFile = path.join(tmp, 'events.log')
      port = await new Promise<number>((resolve) => {
        const server = net.createServer().listen(0, '127.0.0.1', () => {
          const { port: free } = server.address() as net.AddressInfo
          server.close(() => resolve(free))
        })
      })
      registry = makeRegistry()
    })
    afterEach(async () => {
      await registry.dispose()
      rmSync(tmp, { recursive: true, force: true })
    })

    itPosix('runs one agence watch for two panels of the same repository, stopped with the last one', async () => {
      const first = open('a1')
      const second = open('a2')
      await first.session.start()
      await second.session.start()
      await vi.waitFor(() => expect(snap(second.session).regisseur.state).toBe('running'), { timeout: 5000 })
      expect(ofKind('start')).toHaveLength(1)
      second.session.dispose('removed')
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(ofKind('sigterm')).toHaveLength(0)
      expect(snap(first.session).regisseur.state).toBe('running')
      first.session.dispose('removed')
      await vi.waitFor(() => expect(ofKind('sigterm')).toHaveLength(1), { timeout: 5000 })
      await vi.waitFor(() => expect(registry.running()).toBe(0))
    })

    it('finds its follow-up and runs a single regisseur again after the daemon restarts', async () => {
      const before = open('a1')
      await before.session.start()
      await vi.waitFor(() => expect(snap(before.session).regisseur.state).toBe('running'), { timeout: 5000 })
      // The daemon stops: sessions are disposed for the shutdown, the registry too.
      before.session.dispose('shutdown')
      await registry.dispose()
      expect(registry.running()).toBe(0)
      registry = makeRegistry()
      const after = open('a1', before.session.snapshot().ptyId ? { knownTitles: {} } : undefined)
      await after.session.start()
      await vi.waitFor(() => expect(snap(after.session).regisseur.state).toBe('running'), { timeout: 5000 })
      expect(after.terminal.spawns[0]).toMatchObject({ launch: TERMINAL_RESTORE_LAUNCH, restore: true })
      expect(snap(after.session).suivi?.sections.reste).toHaveLength(1)
      expect(registry.running()).toBe(1)
      expect(ofKind('start')).toHaveLength(2)
    })
  })
})
