// The terminal panel's client entry: registers the view, the close guard
// that asks before a running program dies and the tab menu's rendering reset.

import { lazy } from 'react'
import { registerPanelCloseGuard } from '@client/host'
import { registerPanelView } from '../../client/host/views'
import { registerTabMenuItems } from '../../client/layout/dock'
import { terminalCloseGuard } from './confirmClose'
import { terminalTabMenu } from './tabMenu'

registerPanelView('terminal', () => import('./TerminalView'))
registerPanelCloseGuard('terminal', terminalCloseGuard)
registerTabMenuItems(terminalTabMenu)

/** The terminal view as a component, for a panel that runs a PTY of its own
 *  (the agence panel's orchestrator): it binds an xterm to the `ptyId` of the
 *  `TerminalSnapshot` it is given, in the name of the hosting `panelId`. */
export const TerminalPane = lazy(() => import('./TerminalView'))

export { confirmCloseTerminals, runningProcess, snapshotOf, terminalCloseGuard } from './confirmClose'
export { installTerminalViewSettings, type TerminalSettingsSource } from './parts/settings'
