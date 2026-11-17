// A link of the follow-up opens in Cate, never in the system browser: in the
// browser panel already on that URL, else in a new one placed next to the
// agence panel and related to it as context (its agent then sees the page).

import { createPanel, revealPanel } from '@client/host'
import { documentStoreFor } from '@client/document'
import type { PanelId } from '@workspace/document/contract'
import { addRelation } from '../../workspace/relations'

/** The panel showing `url` now, or null when it could not be placed. */
export function openInCate(workspaceId: string, agencePanelId: PanelId, url: string): PanelId | null {
  const doc = documentStoreFor(workspaceId)?.getSnapshot()
  const open = doc && Object.values(doc.panels).find((panel) => panel.type === 'browser' && panel.fields.url === url)
  if (open) {
    void revealPanel(workspaceId, open.id)
    return open.id
  }
  const id = createPanel(workspaceId, 'browser', { url, near: agencePanelId })
  if (!id) return null
  // Refused when relations are off or not allowed between these panels: the page still opens.
  addRelation(workspaceId, agencePanelId, id, 'context')
  void revealPanel(workspaceId, id)
  return id
}
