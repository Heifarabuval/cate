import { registerPanelView } from '../../client/host/views'
import { registerCanvasMenuEntries } from '../../client/layout/canvas'
import { useAppMenuEntries } from './menuEntries'

registerPanelView('app', () => import('./AppPanel'))
registerCanvasMenuEntries(useAppMenuEntries)
