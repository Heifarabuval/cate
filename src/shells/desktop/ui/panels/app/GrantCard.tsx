import type { FolderChanges } from '@panels/app/contract'
import { Button } from '../../kernel/interaction'

/** Files added, changed and removed, one line per kind that has any. */
export function FileChanges({ changes }: { changes: FolderChanges }) {
  const rows = [['Ajoutés', changes.added], ['Changés', changes.changed], ['Retirés', changes.removed]] as const
  return (
    <ul className="mt-1 text-xs">
      {rows.filter(([, paths]) => paths.length).map(([label, paths]) => (
        <li key={label}><span className="text-muted">{label} : </span><span className="font-mono">{paths.join(', ')}</span></li>
      ))}
    </ul>
  )
}

/** What the panel may do, in one sentence, before anything of it runs; for an
 *  installed panel that changed, the files changed since the accepted ones. */
export function GrantCard({ name, sentence, changes, onGrant, onRefuse }: { name: string | null; sentence: string; changes: FolderChanges | null; onGrant(): void; onRefuse(): void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-4 p-6">
      <div className="max-w-md rounded-lg border border-subtle bg-surface-2 p-4 text-sm text-secondary">
        {name && <div className="mb-1 font-medium text-primary">{name}</div>}
        {changes && <p className="mb-1 text-xs">Ce panneau installé a changé depuis votre accord :</p>}
        {changes && <FileChanges changes={changes} />}
        <p className={changes ? 'mt-2' : undefined}>{sentence}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onRefuse}>Refuser</Button>
          <Button size="sm" variant="primary" onClick={onGrant}>Autoriser</Button>
        </div>
      </div>
    </div>
  )
}
