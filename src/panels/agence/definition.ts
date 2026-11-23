// The agence panel type: the orchestrator's conversation next to the project
// follow-up (specs/002-panneau-agence). Pure. No `api`: no `cate` method
// reaches its ops, only the view does. Created from the menus ("Start
// Agence") or by the CLI; its orchestrator's `agence boot` adds the
// interlocuteur and the validation inbox when they are missing.

import { channel } from '@kernel/rpc/contract'
import { definePanel } from '@panels/framework/contract'
import type { JsonObject } from '@workspace/document/contract'
import type { AgenceCreateOptions, AgenceOp, AgenceSnapshot } from './contract/types'

const fields = (options: AgenceCreateOptions): JsonObject => (options.root ? { root: options.root } : {})

export default definePanel({
  type: 'agence',
  label: 'Agence',
  icon: 'briefcase',
  defaultSize: { width: 1000, height: 640 },
  minimumSize: { width: 420, height: 280 },
  canLiveOnCanvas: true,
  ownsKeyboard: true,
  creation: { order: 9, title: 'Start Agence' },
  defaultTitle: 'Agence',
  channel: channel<AgenceSnapshot, Partial<AgenceSnapshot>, AgenceOp>(),
  fields,
  // The orchestrator takes prompts (`cate agent send`) like a terminal's agent.
  relation: { execution: true },
})
