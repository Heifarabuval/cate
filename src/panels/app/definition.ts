// The app panel type: the one compiled type that shows every custom panel, a
// folder of `~/.cate/panneaux/` (spec 008 D1). Pure. No `creation`: the
// generic menus list nothing, the menus' dynamic entries create one record
// per panel (D4, Q6). Its `api` shares panels (spec 007); no `commands`.

import { channel } from '@kernel/rpc/contract'
import { definePanel, type PanelCreateOptions } from '@panels/framework/contract'
import type { JsonObject } from '@workspace/document/contract'
import type { AppOp, AppSnapshot } from './contract'
import { appApi } from './contract/api'

/** The custom panel to show: the name of its folder. */
export interface AppCreateOptions extends PanelCreateOptions {
  appId?: string
}

export default definePanel({
  type: 'app',
  label: 'Panneau perso',
  icon: 'layout-dashboard',
  defaultSize: { width: 900, height: 600 },
  minimumSize: { width: 320, height: 240 },
  canLiveOnCanvas: true,
  // The page lives in a webview the client keeps mounted while the card is culled.
  defaultTitle: 'Panneau perso',
  fields: (options: AppCreateOptions): JsonObject => (options.appId ? { appId: options.appId } : {}),
  channel: channel<AppSnapshot, Partial<AppSnapshot>, AppOp>(),
  api: appApi,
  describe: (record) => (typeof record.fields.appId === 'string' ? record.fields.appId : undefined)
})
