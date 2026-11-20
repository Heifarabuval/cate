// The inbox's keys, declared as actions (docs/architecture.md 12.4): J and K
// move between lines, arrow down passes one, Enter shows the text, Cmd+Enter
// sends what is shown. They run only while the focused panel is an inbox whose
// view is mounted; the view decides what a command does to its own selection.

import { defineActions, storedShortcut } from '@kernel/interaction/contract'
import { documentStoreFor } from '@client/document'
import { focusedLeafPanelId, registerActions, type ActionBinding, type ActionContext } from '@client/host'
import type { BoiteCommand } from '@client/boite'

const key = storedShortcut
const typing = { yieldToText: true, yieldToKeyboardOwner: true, yieldToOverlay: true, windowOnly: true } as const
const once = { ...typing, noRepeat: true } as const

export const BOITE_ACTIONS = defineActions({
  'boite.next': { title: 'Inbox: Next Line', key: key('j'), palette: false, keys: typing },
  'boite.previous': { title: 'Inbox: Previous Line', key: key('k'), palette: false, keys: typing },
  'boite.skip': { title: 'Inbox: Skip Line', key: key('↓'), palette: false, keys: typing },
  'boite.open': { title: 'Inbox: Show Text', key: key('\r'), palette: false, keys: once },
  'boite.send': { title: 'Inbox: Send Shown Text', key: key('\r', { command: true }), palette: false, keys: once },
})

const views = new Map<string, (command: BoiteCommand) => void>()

/** A mounted inbox view takes the commands of its panel. Returns the undo. */
export function bindBoiteKeys(panelId: string, handler: (command: BoiteCommand) => void): () => void {
  views.set(panelId, handler)
  return () => { if (views.get(panelId) === handler) views.delete(panelId) }
}

/** False when no view is mounted for the panel. */
export function runBoiteCommand(panelId: string, command: BoiteCommand): boolean {
  const handler = views.get(panelId)
  handler?.(command)
  return !!handler
}

/** The focused panel of the window's workspace, when it is an inbox with a view. */
function focusedInbox({ workspaceId }: ActionContext): string | null {
  const panelId = workspaceId ? focusedLeafPanelId(workspaceId) : null
  const record = workspaceId && panelId ? documentStoreFor(workspaceId)?.getSnapshot().panels[panelId] : undefined
  return record?.type === 'boite' && views.has(record.id) ? record.id : null
}

function binding(command: BoiteCommand, extra: Pick<ActionBinding, 'enabled'> = {}): ActionBinding {
  return {
    enabled: (context) => focusedInbox(context) !== null && (extra.enabled?.(context) ?? true),
    run(context) {
      const panelId = focusedInbox(context)
      if (panelId) runBoiteCommand(panelId, command)
    },
  }
}

export function registerBoiteActions(): () => void {
  return registerActions(BOITE_ACTIONS, {
    'boite.next': binding('next'),
    'boite.previous': binding('previous'),
    'boite.skip': binding('skip'),
    // On a focused button Enter keeps pressing it.
    'boite.open': binding('open', { enabled: () => !(document.activeElement instanceof HTMLButtonElement) }),
    'boite.send': binding('send'),
  })
}
