import { clientHas } from '@client/connections'
import type { CanvasMenuEntry } from '../../client/layout/canvas/toolbarItems'
import { createPanelOnCanvas } from '../../client/layout/canvas'
import { useApps, useReadyApps } from './useApps'

/** The canvas menu's custom panels: one entry per ready panel (spec 008 D4),
 *  and the page of the panels while a folder is in error, to read why. */
export function useAppMenuEntries(workspaceId: string, canvasId: string): CanvasMenuEntry[] {
  const ready = useReadyApps(workspaceId)
  const broken = (useApps(workspaceId) ?? []).some((entry) => entry.status === 'error') && clientHas('webview')
  const entries: CanvasMenuEntry[] = ready.map((app) => ({
    id: `app:${app.id}`,
    label: app.name,
    icon: app.icon,
    run: (position) => { createPanelOnCanvas(workspaceId, canvasId, 'app', { position, appId: app.id, title: app.name, size: app.size }) }
  }))
  if (broken) {
    entries.push({
      id: 'apps:page',
      label: 'Panneaux perso',
      icon: 'layout-dashboard',
      run: (position) => { createPanelOnCanvas(workspaceId, canvasId, 'app', { position, title: 'Panneaux perso' }) }
    })
  }
  return entries
}
