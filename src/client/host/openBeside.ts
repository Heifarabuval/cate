// "Show this page beside that panel": the browser already on the URL comes
// forward, else a new one opens next to the source and is related to it as
// context (its agent then sees the page). Client core, no UI: every shell
// that lets a panel open links in Cate asks for this one rule.

import type { PanelId } from '@workspace/document/contract'
import { addRelation } from '@workspace/relations/client'
import { documentStoreFor } from '@client/document'
import { createPanel } from './createPanel'
import { panelDefinition, panelTypeOpening } from './definitions'
import { revealPanel } from './reveal'

/** The panel showing `url` now, or null when it could not be opened (no
 *  workspace, no panel type that opens URLs, no place for it). A refused
 *  relation (relations off, panels that take no part) does not stop the page
 *  from opening. */
export function openUrlBeside(workspaceId: string, sourcePanelId: PanelId, url: string): PanelId | null {
  const store = documentStoreFor(workspaceId)
  const type = panelTypeOpening('url')
  if (!store || !type) return null
  // The `url` record field is the `opens: ['url']` contract: the create option
  // of the same name lands in it.
  const open = Object.values(store.getSnapshot().panels).find((panel) => panel.type === type && panel.fields.url === url)
  if (open) {
    void revealPanel(workspaceId, open.id)
    return open.id
  }
  const id = createPanel(workspaceId, type, { url, near: sourcePanelId })
  if (!id) return null
  addRelation(store, (panelType) => panelDefinition(panelType)?.relation, sourcePanelId, id, 'context')
  void revealPanel(workspaceId, id)
  return id
}
