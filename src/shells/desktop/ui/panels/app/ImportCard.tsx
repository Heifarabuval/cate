import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { tryRuntimeFor } from '@kernel/rpc/client'
import { clientUi } from '@kernel/interaction'
import { grantSentence, type AppManifest, type PendingImport } from '@panels/app/contract'
import { isLoopbackHostname } from '@runtime/tunnel/contract'
import { Button } from '../../kernel/interaction'
import { FileChanges } from './GrantCard'

// A declared host may carry a port or a `*.` wildcard; `[::1]` keeps its brackets.
const bareHost = (host: string) => host.replace(/^\*\./, '').replace(/^(\[[^\]]*\]|[^:]+):\d+$/, '$1')

/** The red alerts of FR-016. ponytail: no `** / *` alert, add it when the file bridge exists. */
function alertsOf(permissions: AppManifest['permissions']): string[] {
  const alerts: string[] = []
  if (permissions.files.read.length && permissions.network.length)
    alerts.push('Il lit des fichiers et parle à internet : ce qu’il lit peut partir vers ces hôtes.')
  if (permissions.network.some((host) => isLoopbackHostname(bareHost(host))))
    alerts.push('Il parle à un service de votre machine (localhost) : il peut atteindre vos services locaux.')
  return alerts
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} o` : `${(bytes / 1024 ** (bytes < 1024 ** 2 ? 1 : 2)).toFixed(1).replace('.', ',')} ${bytes < 1024 ** 2 ? 'Ko' : 'Mo'}`

/** An import waiting for a human's click: what it is, what it may do, and Installer or Annuler.
 *  The view asks; the runtime installs (`apps.acceptImport`) with the fingerprint shown here. */
export function ImportCard({ workspaceId, item }: { workspaceId: string; item: PendingImport }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { manifest } = item

  const run = async (action: 'accept' | 'replace' | 'drop') => {
    if (busy) return
    if (action === 'replace' && item.replaces === 'local'
      && !(await clientUi().confirm(`Remplacer votre panneau local « ${item.appId} » ? Ses fichiers seront écrasés.`))) return
    const apps = tryRuntimeFor(workspaceId)?.apps
    if (!apps) return setError('Workspace déconnecté : réessayer une fois reconnecté.')
    setBusy(true)
    setError(null)
    try {
      if (action === 'drop') await apps.dropImport({ importId: item.importId })
      else await apps.acceptImport({ importId: item.importId, fingerprint: item.fingerprint, ...(action === 'replace' ? { replace: true } : {}) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-subtle bg-surface-2 p-3 text-sm text-secondary">
      <div className="font-medium text-primary">{manifest.name}</div>
      {manifest.description && <div className="text-xs text-muted">{manifest.description}</div>}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
        <dt className="text-muted">Source</dt><dd className="truncate">{item.source}</dd>
        <dt className="text-muted">Empreinte</dt><dd className="select-all font-mono" title={item.fingerprint}>{item.fingerprint.slice(0, 12)}</dd>
        <dt className="text-muted">Contenu</dt><dd>{item.files} fichiers, {formatSize(item.size)}</dd>
      </dl>
      <p className="mt-2">{grantSentence(manifest)}</p>
      <p className="mt-1 text-xs text-muted">Cate ne connaît pas l’auteur : vérifiez l’empreinte auprès de l’expéditeur.</p>
      {alertsOf(manifest.permissions).map((alert) => (
        <div key={alert} data-alert className="mt-1 flex items-start gap-1.5 text-xs text-red-400"><TriangleAlert size={12} className="mt-0.5 shrink-0" />{alert}</div>
      ))}
      {item.replaces && (
        <div className="mt-2 text-xs">
          <p>{item.replaces === 'local' ? `Cet import remplace votre panneau local « ${item.appId} ».` : `Cet import remplace un panneau installé « ${item.appId} ».`}</p>
          {item.diff && <FileChanges changes={item.diff} />}
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('drop')}>Annuler</Button>
        {item.replaces
          ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run('replace')}>Remplacer</Button>
          : <Button size="sm" variant="primary" disabled={busy} onClick={() => void run('accept')}>Installer</Button>}
      </div>
    </div>
  )
}
