// What tells the journal a fact: the document (a panel created, closed or
// linked) and a browser panel (a page it went to). A source gives a type and
// an id, or an address: never a title, a field of a record or a content. The
// journal cleans every fact again on receipt (`cleanInput`).

import type { DocOp, WorkspaceDocument } from '@workspace/document/contract'
import type { ObservationInput } from '../contract'

/** The document as a source reads it: each applied op, with the document before and after it. */
export interface DocumentSource {
  subscribe(listener: (event: { op: DocOp; before: WorkspaceDocument; doc: WorkspaceDocument }) => void): () => void
}

// A drag sends dozens of ops a second and none of them creates, closes or
// links a panel: those ops are not even looked at.
const PANEL_OPS: ReadonlySet<string> = new Set(['addPanel', 'replacePanel', 'removePanels', 'closeWindow', 'addRelation'])

const touchesPanels = (op: DocOp): boolean =>
  op.kind === 'batch' ? op.changes.some((change) => PANEL_OPS.has(change.kind)) : PANEL_OPS.has(op.kind)

/**
 * The facts an op made, read from the document before and after it, so one
 * rule covers an op, a batch and a window that closes with its panels. A
 * surface is the picker, not a panel the person works in: the panel it
 * becomes is the one created. A link is told by the type and the id of the
 * panel it starts from.
 */
export function documentFacts(before: WorkspaceDocument, doc: WorkspaceDocument): ObservationInput[] {
  const facts: ObservationInput[] = []
  for (const [id, record] of Object.entries(doc.panels)) {
    if (record.type !== 'surface' && before.panels[id]?.type !== record.type) facts.push({ kind: 'panel.created', panelType: record.type, ref: id })
  }
  for (const [id, record] of Object.entries(before.panels)) {
    if (!doc.panels[id] && record.type !== 'surface') facts.push({ kind: 'panel.closed', panelType: record.type, ref: id })
  }
  for (const [id, relation] of Object.entries(doc.relations)) {
    const from = doc.panels[relation.fromPanelId]
    if (!before.relations[id] && from) facts.push({ kind: 'panel.linked', panelType: from.type, ref: from.id })
  }
  return facts
}

/**
 * Follows the document; returns the way to stop. While `enabled` says no
 * (the person did not accept, or paused), an op is not even read.
 */
export function watchDocument(source: DocumentSource, observe: (fact: ObservationInput) => void, enabled: () => boolean): () => void {
  return source.subscribe(({ op, before, doc }) => {
    if (!enabled() || !touchesPanels(op)) return
    for (const fact of documentFacts(before, doc)) observe(fact)
  })
}

/** A browser panel went to a page. The address comes as it is: the journal strips it. */
export function navigationFact(url: string): ObservationInput {
  return { kind: 'navigate', panelType: 'browser', ref: url }
}
