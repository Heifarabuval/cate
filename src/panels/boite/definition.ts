// The boite panel type: one inbox of the human's pending validations across
// the projects open in this client (specs/003-boite-validation). It is a
// client view: no session state, no process, no file, no `api`. Pure.

import { channel } from '@kernel/rpc/contract'
import { storedShortcut } from '@kernel/interaction/contract'
import { definePanel } from '@panels/framework/contract'
import type { JsonObject } from '@workspace/document/contract'

export default definePanel({
  type: 'boite',
  label: 'Boîte de validation',
  icon: 'inbox',
  defaultSize: { width: 520, height: 640 },
  minimumSize: { width: 320, height: 280 },
  canLiveOnCanvas: true,
  creation: { order: 10, title: 'Open Validation Inbox', key: storedShortcut('i', { command: true, shift: true }), unique: true },
  defaultTitle: 'Boîte de validation',
  channel: channel<JsonObject, Partial<JsonObject>, never>(),
})
