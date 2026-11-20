import { registerPanelView } from '../../client/host/views'

registerPanelView('boite', () => import('./BoiteView'))
