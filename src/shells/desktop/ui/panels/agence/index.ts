import { registerPanelView } from '../../client/host/views'

registerPanelView('agence', () => import('./AgenceView'))
