import { registerPanelCloseGuard } from '@client/host'
import { registerPanelView } from '../../client/host/views'
import { agenceCloseGuard } from './confirmClose'

registerPanelView('agence', () => import('./AgenceView'))
registerPanelCloseGuard('agence', agenceCloseGuard)
