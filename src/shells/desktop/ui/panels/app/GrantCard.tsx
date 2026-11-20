import { Button } from '../../kernel/interaction'

/** What the panel may do, in one sentence, before anything of it runs. */
export function GrantCard({ name, sentence, onGrant, onRefuse }: { name: string | null; sentence: string; onGrant(): void; onRefuse(): void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-4 p-6">
      <div className="max-w-md rounded-lg border border-subtle bg-surface-2 p-4 text-sm text-secondary">
        {name && <div className="mb-1 font-medium text-primary">{name}</div>}
        <p>{sentence}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onRefuse}>Refuser</Button>
          <Button size="sm" variant="primary" onClick={onGrant}>Autoriser</Button>
        </div>
      </div>
    </div>
  )
}
