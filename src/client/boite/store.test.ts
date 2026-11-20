import { describe, expect, it, vi } from 'vitest'
import type { AgenceSnapshot, NeedRow } from '@panels/agence/contract'
import type { SessionHandle } from '@client/connections'
import { createBoiteStore, type BoiteDeps } from './store'

const need = (id: string): NeedRow => ({
  id, title: `Besoin ${id}`, kind: 'human', meta: [], evidence: null, link: null, links: [], action: null,
  created: '2026-11-19T10:00:00+00:00',
})

const snap = (ids: string[], repo = 'cate'): AgenceSnapshot => ({
  ptyId: null,
  orchestrator: 'running',
  regisseur: { state: 'running', error: null, settingsHint: null },
  suivi: { repo, humain: 'H', agentsActive: 0, readAt: 'x', error: null, sections: { bloquant: [], aFaire: ids.map(need), fait: [], reste: [] } },
  drafts: {},
  questions: {},
  garde: 'actif',
})

/** A session channel the test drives. */
function fakeSession(panelId: string, initial: AgenceSnapshot | null) {
  const listeners = new Set<() => void>()
  let current = initial
  const handle: SessionHandle<AgenceSnapshot> = {
    panelId,
    getSnapshot: () => (current ? { rev: 1, snapshot: current } : null),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    send: vi.fn(async () => ({ ok: true })),
    release: vi.fn(),
  }
  return { handle, set(next: AgenceSnapshot) { current = next; for (const listener of [...listeners]) listener() }, listeners }
}

type FakeSession = ReturnType<typeof fakeSession>

/** A tiny observable world: connections, their documents, the workspace list. */
function world() {
  const sessions = new Map<string, FakeSession>() // `${workspaceId}/${panelId}`
  const connections = new Map<string, { workspaceId: string; subscribeSession: ReturnType<typeof vi.fn> }>()
  type DocFake = {
    panels: Record<string, { id: string; type: string; fields: Record<string, unknown> }>
    listeners: Set<() => void>
    view: NonNullable<ReturnType<BoiteDeps['documents']['get']>>
  }
  const documents = new Map<string, DocFake>()
  const connectionListeners = new Set<() => void>()
  const documentListeners = new Set<() => void>()
  const workspaceListeners = new Set<() => void>()
  let entries: Array<{ id: string; kind: 'local'; root: string; name: string; lastOpenedAt: number }> = []
  let snapshot: readonly unknown[] = []
  const notify = (set: Set<() => void>) => { for (const listener of [...set]) listener() }
  const writes: unknown[] = []

  const deps: BoiteDeps = {
    connections: {
      getSnapshot: () => snapshot as never,
      subscribe: (listener) => { connectionListeners.add(listener); return () => { connectionListeners.delete(listener) } },
    },
    documents: {
      get: (workspaceId) => documents.get(workspaceId)?.view ?? null,
      subscribe: (listener) => { documentListeners.add(listener); return () => { documentListeners.delete(listener) } },
    },
    workspaces: {
      getSnapshot: () => ({ entries: entries as never, open: [...connections.keys()] }),
      subscribe: (listener) => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener) } },
    },
  }

  return {
    deps,
    writes,
    sessions,
    /** A workspace opens with agence panels (`panelId` to its first snapshot, or null). */
    open(workspaceId: string, root: string, panels: Record<string, AgenceSnapshot | null>, fieldsRoot?: string) {
      entries = [...entries.filter((e) => e.id !== workspaceId), { id: workspaceId, kind: 'local', root, name: root, lastOpenedAt: 0 }]
      const doc: DocFake = {
        panels: {},
        listeners: new Set<() => void>(),
        view: {
          getSnapshot: () => ({ panels: doc.panels }) as never,
          subscribe: (listener) => { doc.listeners.add(listener); return () => { doc.listeners.delete(listener) } },
        },
      }
      documents.set(workspaceId, doc)
      const connection = {
        workspaceId,
        subscribeSession: vi.fn((panelId: string) => sessions.get(`${workspaceId}/${panelId}`)!.handle),
      }
      connections.set(workspaceId, connection)
      for (const [panelId, initial] of Object.entries(panels)) {
        sessions.set(`${workspaceId}/${panelId}`, fakeSession(panelId, initial))
        doc.panels[panelId] = { id: panelId, type: 'agence', fields: fieldsRoot ? { root: fieldsRoot } : {} }
      }
      snapshot = [...connections.values()]
      notify(connectionListeners); notify(documentListeners); notify(workspaceListeners)
      return connection
    },
    addPanel(workspaceId: string, panelId: string, initial: AgenceSnapshot | null) {
      sessions.set(`${workspaceId}/${panelId}`, fakeSession(panelId, initial))
      const doc = documents.get(workspaceId)!
      doc.panels = { ...doc.panels, [panelId]: { id: panelId, type: 'agence', fields: {} } }
      notify(doc.listeners)
    },
    close(workspaceId: string) {
      connections.delete(workspaceId)
      documents.delete(workspaceId)
      snapshot = [...connections.values()]
      notify(connectionListeners); notify(documentListeners); notify(workspaceListeners)
    },
    known(workspaceId: string, root: string) {
      entries = [...entries, { id: workspaceId, kind: 'local', root, name: root, lastOpenedAt: 0 }]
      notify(workspaceListeners)
    },
  }
}

describe('createBoiteStore', () => {
  it('has no effect until someone subscribes', () => {
    const w = world()
    const open = w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    createBoiteStore(w.deps)
    expect(open.subscribeSession).not.toHaveBeenCalled()
  })

  it('merges the agence panels of every open workspace, the root being fields.root or the workspace', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap(['n1', 'n2']) })
    w.open('local:/a/lamif', '/a/lamif', { p1: snap([], 'lamif') })
    w.open('local:/a/skills', '/a/skills', { p1: snap(['n1'], 'skills') }, '/a/skills/sub')
    const store = createBoiteStore(w.deps)
    store.subscribe(() => {})
    const state = store.getSnapshot()
    expect(state.rows.map((row) => row.key)).toEqual(['/a/cate#n1', '/a/cate#n2', '/a/skills/sub#n1'])
    expect(state.projects.map((project) => project.repo)).toEqual(['cate', 'lamif', 'skills'])
    expect(state.closedWorkspaces).toBe(0)
  })

  it('a session snapshot reaches the rows at once', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap([]) })
    const store = createBoiteStore(w.deps)
    const seen = vi.fn()
    store.subscribe(seen)
    expect(store.getSnapshot().rows).toEqual([])
    w.sessions.get('local:/a/cate/p1')!.set(snap(['n7']))
    expect(seen).toHaveBeenCalled()
    expect(store.getSnapshot().rows.map((row) => row.key)).toEqual(['/a/cate#n7'])
  })

  it('a workspace opened, or an agence panel created, after the inbox joins without a restart', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    const store = createBoiteStore(w.deps)
    store.subscribe(() => {})
    w.open('local:/a/lamif', '/a/lamif', { p1: snap(['n2'], 'lamif') })
    expect(store.getSnapshot().rows.map((row) => row.key)).toEqual(['/a/cate#n1', '/a/lamif#n2'])
    w.addPanel('local:/a/cate', 'p2', snap(['n3'], 'other'))
    expect(store.getSnapshot().projects).toHaveLength(3)
  })

  it('a workspace that closes drops its rows and counts as not open; handles are released', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    w.open('local:/a/lamif', '/a/lamif', { p1: snap(['n2'], 'lamif') })
    w.known('local:/a/old', '/a/old')
    const store = createBoiteStore(w.deps)
    store.subscribe(() => {})
    expect(store.getSnapshot().closedWorkspaces).toBe(1)
    w.close('local:/a/lamif')
    const state = store.getSnapshot()
    expect(state.rows.map((row) => row.key)).toEqual(['/a/cate#n1'])
    expect(state.projects).toHaveLength(1)
    expect(state.closedWorkspaces).toBe(2)
    expect(w.sessions.get('local:/a/lamif/p1')!.handle.release).toHaveBeenCalledTimes(1)
  })

  it('releases every handle and stops listening when the last subscriber leaves', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    const store = createBoiteStore(w.deps)
    const stop = store.subscribe(() => {})
    const session = w.sessions.get('local:/a/cate/p1')!
    expect(session.listeners.size).toBe(1)
    stop()
    expect(session.handle.release).toHaveBeenCalledTimes(1)
    expect(session.listeners.size).toBe(0)
  })

  it('reads and subscribes only: no op is sent, and the snapshot holds nothing but the merge', () => {
    const w = world()
    w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    const store = createBoiteStore(w.deps)
    store.subscribe(() => {})
    for (const session of w.sessions.values()) expect(session.handle.send).not.toHaveBeenCalled()
    expect(Object.keys(store.getSnapshot()).sort()).toEqual(['closedWorkspaces', 'projects', 'rows'])
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/token|jeton/i)
  })

  it('takes a new connection of the same workspace (a reconnect) and rereads it', () => {
    const w = world()
    const first = w.open('local:/a/cate', '/a/cate', { p1: snap(['n1']) })
    const store = createBoiteStore(w.deps)
    store.subscribe(() => {})
    const second = w.open('local:/a/cate', '/a/cate', { p1: snap(['n2']) })
    expect(second).not.toBe(first)
    expect(store.getSnapshot().rows.map((row) => row.key)).toEqual(['/a/cate#n2'])
  })
})
