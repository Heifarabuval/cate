// `cate.panel.*` and `cate.canvas.*` (architecture 14): panels as document
// records. Creating a panel and asking sessions before a close belong to the
// panel framework, a higher layer, so the composition root passes them in.

import type { Point } from '@workspace/canvas/contract'
import type { CateServiceHandlers } from '@kernel/api/contract'
import type { ApiRouter } from '@kernel/api/runtime'
import { randomUUID } from 'node:crypto'
import { RpcError } from '@kernel/rpc/contract'
import { removalSet, renamePanelChange, type PanelId, type PanelRecord, type RelationKind } from '../contract'
import { canvasApi, frameApi, panelApi } from '../contract/api'
import type { DocumentService } from './documentService'
import { createFrameApiHandlers } from './frameApi'
import type { PresenceService } from './presence'

/** A `cate.canvas.createPanel` call as the panel framework receives it. */
export type CreatePanelRequest = {
  /** The calling panel: the new one is placed next to it. */
  near?: PanelId
  position?: Point
  url?: string
  filePath?: string
  placementGroupId?: string
}

export interface DocumentApiDeps {
  document: DocumentService
  presence: Pick<PresenceService, 'activePanelId'>
  /** Throws `RpcError('dirty')` when removing `removing` loses work outside
   *  `discard` (the sessions' close blockers). */
  checkRemoval(removing: ReadonlySet<PanelId>, discard: ReadonlySet<PanelId>): void
  /** Returns the new panel's id, or null when it could not be created. */
  createPanel(type: string, request: CreatePanelRequest): PanelId | null | Promise<PanelId | null>
  /** Extra columns of `cate panel list` for one record. */
  listInfo?(record: PanelRecord): { filePath?: string; url?: string } | undefined
  /** The relation kinds the pair offers, the recommended one first
   *  (workspace/relations, a module above the document). */
  relationKinds(from: PanelRecord, to: PanelRecord): readonly RelationKind[]
}

export interface PanelListRow {
  panelId: PanelId
  type: string
  title: string
  focused: boolean
  /** The worktree the panel works in (`cate agent start --worktree`). */
  worktreeId?: string
  filePath?: string
  url?: string
  /** Outgoing relations. */
  relations: Array<{ relationId: string; toPanelId: PanelId; kind: RelationKind; label?: string }>
}

/** Relates two panels, or changes a related pair's relation (one per pair):
 *  what `link` leaves out stays, an empty label clears it. A new relation
 *  without a kind takes the pair's recommended one. Refuses a kind the pair
 *  does not offer, and throws what the document's relation guard refuses
 *  (`rejected`, `gone`). */
export function linkPanels(
  document: Pick<DocumentService, 'get' | 'apply'>,
  relationKinds: DocumentApiDeps['relationKinds'],
  link: { fromPanelId: PanelId; toPanelId: PanelId; kind?: RelationKind; label?: string },
): { relationId: string; kind: RelationKind } {
  const { fromPanelId, toPanelId } = link
  const { panels, relations } = document.get()
  const from = panels[fromPanelId]
  const to = panels[toPanelId]
  if (!from || !to) throw new RpcError('gone', `panel ${from ? toPanelId : fromPanelId} is gone`)
  const offered = relationKinds(from, to)
  if (link.kind && !offered.includes(link.kind)) {
    throw new RpcError('rejected', `these panels relate with ${offered.join(', ')}, not ${link.kind}`)
  }
  const label = link.label?.trim()
  const existing = Object.values(relations).find((r) => r.fromPanelId === fromPanelId && r.toPanelId === toPanelId)
  if (existing) {
    const kind = link.kind ?? existing.kind
    document.apply({ kind: 'updateRelation', id: existing.id, patch: { kind, ...(label !== undefined ? { label: label || null } : {}) } })
    return { relationId: existing.id, kind }
  }
  const kind = link.kind ?? offered[0]
  const relationId = randomUUID()
  document.apply({ kind: 'addRelation', relation: { id: relationId, fromPanelId, toPanelId, kind, ...(label ? { label } : {}) } })
  return { relationId, kind }
}

/** Default list columns: the record's own `filePath` and `url` fields. */
function fieldInfo(record: PanelRecord): { filePath?: string; url?: string } {
  const { filePath, url } = record.fields
  return {
    ...(typeof filePath === 'string' ? { filePath } : {}),
    ...(typeof url === 'string' ? { url } : {}),
  }
}

export function createDocumentApiHandlers(deps: DocumentApiDeps): {
  panel: CateServiceHandlers<typeof panelApi>
  canvas: CateServiceHandlers<typeof canvasApi>
  frame: CateServiceHandlers<typeof frameApi>
} {
  const { document } = deps
  const info = deps.listInfo ?? fieldInfo

  return {
    panel: {
      list: (): PanelListRow[] => {
        const active = deps.presence.activePanelId()
        const relations = Object.values(document.get().relations)
        return Object.values(document.get().panels).map((record) => ({
          panelId: record.id,
          type: record.type,
          title: record.title,
          focused: record.id === active,
          ...(record.worktreeId ? { worktreeId: record.worktreeId } : {}),
          ...info(record),
          relations: relations.filter((r) => r.fromPanelId === record.id).map((r) => ({
            relationId: r.id,
            toPanelId: r.toPanelId,
            kind: r.kind,
            ...(r.label ? { label: r.label } : {}),
          })),
        }))
      },
      link: (args) => linkPanels(document, deps.relationKinds, args),
      unlink: ({ fromPanelId, toPanelId }) => {
        const relation = Object.values(document.get().relations).find((r) => r.fromPanelId === fromPanelId && r.toPanelId === toPanelId)
        if (!relation) throw new RpcError('gone', 'these panels are not related')
        document.apply({ kind: 'removeRelation', id: relation.id })
        return { removed: relation.id }
      },
      close: async ({ panelId, discard }) => {
        if (!document.get().panels[panelId]) throw new RpcError('gone', `panel ${panelId} is gone`)
        const removing = removalSet(document.get(), [panelId])
        const ids = [...removing]
        try {
          deps.checkRemoval(removing, new Set(discard === true ? ids : []))
        } catch (err) {
          if (err instanceof RpcError && err.code === 'dirty') {
            throw new RpcError('dirty', `${err.message}; pass --discard to close it anyway`, err.data)
          }
          throw err
        }
        document.apply({ kind: 'removePanels', ids: [panelId], ...(discard === true ? { discard: ids } : {}) })
        return { panelIds: ids }
      },
      setTitle: ({ title, panelId }, ctx) => {
        const target = panelId ?? ctx.caller.panelId
        if (!target) throw new RpcError('rejected', 'no panel: pass --panel <id>')
        document.apply(renamePanelChange(target, title))
        return { panelId: target, title }
      },
      'target.set': ({ panelId }, ctx) => {
        ctx.sticky.set(panelId)
        return { panelId }
      },
      'target.current': (_args, ctx) => {
        const panelId = ctx.sticky.get()
        if (panelId && !document.get().panels[panelId]) {
          ctx.sticky.clear()
          return { panelId: null }
        }
        return { panelId: panelId ?? null }
      },
      'target.clear': (_args, ctx) => {
        ctx.sticky.clear()
        return null
      },
    },
    canvas: {
      createPanel: async ({ type, url, filePath, position }, ctx) => {
        const panelId = await deps.createPanel(type, {
          ...(ctx.caller.panelId ? { near: ctx.caller.panelId } : {}),
          ...(ctx.caller.placementGroupId ? { placementGroupId: ctx.caller.placementGroupId } : {}),
          ...(position ? { position } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(filePath !== undefined ? { filePath } : {}),
        })
        if (!panelId) throw new RpcError('rejected', `could not create a ${type} panel`)
        return { panelId }
      },
    },
    frame: createFrameApiHandlers(document),
  }
}

export function registerDocumentApi(router: Pick<ApiRouter, 'registerService'>, deps: DocumentApiDeps): () => void {
  const handlers = createDocumentApiHandlers(deps)
  const offPanel = router.registerService(panelApi, handlers.panel)
  const offCanvas = router.registerService(canvasApi, handlers.canvas)
  const offFrame = router.registerService(frameApi, handlers.frame)
  return () => { offPanel(); offCanvas(); offFrame() }
}
