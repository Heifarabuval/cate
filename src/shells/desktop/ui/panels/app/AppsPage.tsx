import { TriangleAlert } from 'lucide-react'
import { useApps } from './useApps'

/** The custom panels of `~/.cate/panneaux/`, and why a folder does not load. */
export function AppsPage({ workspaceId }: { workspaceId: string }) {
  const list = useApps(workspaceId)
  if (!list) return <div className="flex h-full items-center justify-center bg-surface-4 text-xs text-muted">Chargement</div>
  const blocked = list.some((entry) => entry.status === 'blocked')
  return (
    <div className="h-full overflow-auto bg-surface-4 p-4 text-sm text-secondary">
      <h2 className="mb-3 text-sm font-medium text-primary">Panneaux perso</h2>
      {blocked && <p className="mb-3 text-xs text-muted">Workspace non approuvé : aucun panneau perso ne se charge.</p>}
      {list.length === 0 && <p className="text-xs text-muted">Aucun panneau. Un panneau est un dossier de ~/.cate/panneaux/.</p>}
      <ul className="flex flex-col gap-2">
        {list.map((entry) => (
          <li key={entry.id} className="rounded-md border border-subtle bg-surface-2 p-3">
            <div className="font-medium text-primary">{entry.status === 'ready' ? entry.name : entry.id}</div>
            {entry.status === 'ready' && <div className="text-xs text-muted">{entry.description}</div>}
            {entry.status === 'error' && (
              <div className="mt-1 flex items-start gap-1.5 text-xs text-red-400"><TriangleAlert size={12} className="mt-0.5 shrink-0" />{entry.error}</div>
            )}
            {entry.warnings.map((warning) => <div key={warning} className="mt-1 text-xs text-muted">{warning}</div>)}
          </li>
        ))}
      </ul>
    </div>
  )
}
