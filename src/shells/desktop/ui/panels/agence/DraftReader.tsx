import { useRef, useState } from 'react'
import type { AgenceOp, AgenceOpResult, DraftView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'
import { MarkdownPreview } from '../editor/MarkdownPreview'
import { ACTION, ACTION_DANGER } from './styles'

const KINDS: Record<DraftView['kind'], string> = {
  issue: 'Issue', pr: 'Pull request', comment: 'Commentaire', slack: 'Message Slack', mail: 'Mail',
}

/** What a refusal says, in the regisseur's own words when it gave some. */
function refusal(result: Extract<AgenceOpResult, { ok: false }>): string {
  if (result.error === 'invalid') return 'Brouillon introuvable.'
  if (result.error === 'unavailable') return `Régisseur indisponible${result.message ? ` : ${result.message}` : '.'}`
  if (/texte a changé/.test(result.message ?? '')) return 'Le texte a changé, relis avant d\'envoyer.'
  return result.message ?? 'Action refusée.'
}

export interface DraftReaderProps {
  workspaceId: string
  panelId: string
  draft: DraftView
  send(op: AgenceOp): Promise<unknown>
  onBack(): void
}

/** A draft as the person will send it: the text rendered, then Modifier,
 *  Abandonner, Envoyer. Envoyer carries the hash of the text shown, so a text
 *  edited since is refused by the regisseur, never sent. */
export default function DraftReader({ workspaceId, panelId, draft, send, onBack }: DraftReaderProps) {
  const [pending, setPending] = useState(false)
  // Set before React re-renders: a second click in the same batch is ignored.
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const open = draft.statut === 'à valider'

  const run = async (op: AgenceOp, leave: boolean) => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(null)
    try {
      const result = await send(op) as AgenceOpResult
      if (result.ok) {
        if (leave) onBack()
      } else {
        setError(refusal(result))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      lock.current = false
      setPending(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={onBack}>Retour</Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold text-primary" title={draft.titre ?? undefined}>{draft.titre ?? KINDS[draft.kind]}</h1>
          <div className="truncate text-[11px] text-secondary">{KINDS[draft.kind]} · {draft.cible} · {draft.statut === 'envoyer' ? "En cours d'envoi" : draft.statut}</div>
        </div>
      </div>
      <div className="relative min-h-[200px] flex-1 overflow-hidden rounded-lg border border-subtle bg-surface-2">
        <MarkdownPreview content={draft.texte} workspaceId={workspaceId} panelId={panelId} filePath={`${draft.id}.md`} noImages />
      </div>
      {error && <InlineNotice tone="error" className="!text-primary">{error}</InlineNotice>}
      {open && (
        <div data-testid="draft-actions" className="flex shrink-0 items-center justify-end gap-1.5">
          <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={pending} onClick={() => void run({ kind: 'draft.edit', draftId: draft.id }, false)}>Modifier</Button>
          <Button size="sm" className={ACTION_DANGER} disabled={pending} onClick={() => void run({ kind: 'draft.drop', draftId: draft.id }, true)}>Abandonner</Button>
          <Button size="sm" className={ACTION} disabled={pending} onClick={() => void run({ kind: 'draft.send', draftId: draft.id, hash: draft.hash }, true)}>Envoyer</Button>
        </div>
      )}
    </div>
  )
}
