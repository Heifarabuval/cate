// The validation inbox's store: it reads the agence panels of every workspace
// the client has open (one connection each) through their session channels and
// merges their snapshots into rows. It writes nothing. Nothing runs until the
// first subscriber; the last one to leave releases every session handle.

import type { AgenceSnapshot } from '@panels/agence/contract'
import type { PanelRecord } from '@workspace/document/contract'
import type { SessionHandle } from '@client/connections'
import { workspaceLocation, type WorkspaceEntry } from '@client/workspaces'
import { merge } from './merge'
import type { BoiteSnapshot, ProjectInput } from './types'

/** The part of a `WorkspaceConnection` the inbox uses. */
export interface BoiteConnection {
  readonly workspaceId: string
  subscribeSession<S = unknown>(panelId: string): SessionHandle<S>
}

export interface BoiteDeps {
  connections: {
    getSnapshot(): readonly BoiteConnection[]
    subscribe(listener: () => void): () => void
  }
  documents: {
    /** A workspace's document mirror, null when it has none. The same object each time. */
    get(workspaceId: string): { getSnapshot(): { panels: Readonly<Record<string, PanelRecord>> }; subscribe(listener: () => void): () => void } | null
    /** A mirror comes or goes. */
    subscribe(listener: () => void): () => void
  }
  workspaces: {
    getSnapshot(): { entries: readonly WorkspaceEntry[]; open: readonly string[] }
    subscribe(listener: () => void): () => void
  }
}

export interface BoiteStore {
  getSnapshot(): BoiteSnapshot
  subscribe(listener: () => void): () => void
}

const EMPTY: BoiteSnapshot = { projects: [], rows: [], closedWorkspaces: 0 }

interface Watch {
  connection: BoiteConnection
  workspaceId: string
  panelId: string
  handle: SessionHandle<AgenceSnapshot>
  stop(): void
}

export function createBoiteStore(deps: BoiteDeps): BoiteStore {
  const listeners = new Set<() => void>()
  let state = EMPTY
  let active: { watches: Map<string, Watch>; documents: Map<string, { document: object; stop(): void }>; stops: Array<() => void> } | null = null

  const rootOf = (workspaceId: string, record: PanelRecord): string => {
    const own = record.fields.root
    if (typeof own === 'string' && own) return own
    const entry = deps.workspaces.getSnapshot().entries.find((candidate) => candidate.id === workspaceId)
    return (entry && workspaceLocation(entry)) ?? workspaceId
  }

  function recompute(): void {
    if (!active) return
    const { watches, documents } = active
    const connections = deps.connections.getSnapshot()
    const wanted = new Map<string, { connection: BoiteConnection; record: PanelRecord }>()
    const documentIds = new Set<string>()
    for (const connection of connections) {
      const document = deps.documents.get(connection.workspaceId)
      if (!document) continue
      documentIds.add(connection.workspaceId)
      if (documents.get(connection.workspaceId)?.document !== document) {
        documents.get(connection.workspaceId)?.stop()
        documents.set(connection.workspaceId, { document, stop: document.subscribe(recompute) })
      }
      for (const record of Object.values(document.getSnapshot().panels)) {
        if (record.type === 'agence') wanted.set(`${connection.workspaceId}/${record.id}`, { connection, record })
      }
    }
    for (const [id, entry] of documents) {
      if (documentIds.has(id)) continue
      documents.delete(id)
      entry.stop()
    }
    for (const [key, watch] of watches) {
      if (wanted.get(key)?.connection === watch.connection) continue
      watches.delete(key)
      watch.stop()
      watch.handle.release()
    }
    for (const [key, { connection, record }] of wanted) {
      if (watches.has(key)) continue
      const handle = connection.subscribeSession<AgenceSnapshot>(record.id)
      watches.set(key, { connection, workspaceId: connection.workspaceId, panelId: record.id, handle, stop: handle.subscribe(recompute) })
    }
    const inputs: ProjectInput[] = [...wanted].map(([key, { connection, record }]) => ({
      workspaceId: connection.workspaceId,
      panelId: record.id,
      root: rootOf(connection.workspaceId, record),
      snapshot: watches.get(key)?.handle.getSnapshot()?.snapshot ?? null,
    }))
    const { entries, open } = deps.workspaces.getSnapshot()
    state = { ...merge(inputs), closedWorkspaces: entries.filter((entry) => !open.includes(entry.id)).length }
    for (const listener of [...listeners]) listener()
  }

  function start(): void {
    active = { watches: new Map(), documents: new Map(), stops: [] }
    active.stops.push(deps.connections.subscribe(recompute), deps.documents.subscribe(recompute), deps.workspaces.subscribe(recompute))
    recompute()
  }

  function stop(): void {
    const current = active
    active = null
    if (!current) return
    for (const end of current.stops) end()
    for (const { stop: end } of current.documents.values()) end()
    for (const watch of current.watches.values()) {
      watch.stop()
      watch.handle.release()
    }
    state = EMPTY
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (!active) start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }
}
