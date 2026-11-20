import type { AgenceOp, AgenceOpResult, DraftView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import { MarkdownPreview } from '../editor/MarkdownPreview'
import { ACTION, ACTION_DANGER } from './styles'

const KINDS: Record<DraftView['kind'], string> = {
  issue: 'Issue', pr: 'Pull request', comment: 'Commentaire', slack: 'Message Slack', mail: 'Mail',
}

/** What a refused draft op says: the draft's own cases, then the shared refusal. */
function draftRefusal(result: Extract<AgenceOpResult, { ok: false }>): string {
  if (result.error === 'invalid') return 'Brouillon introuvable.'
  if (/texte a changé/.test(result.message ?? '')) return 'Le texte a changé, relis avant d\'envoyer.'
  return refusal(result, 'Action refusée.')
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
  const { run, active, done, error, waiting } = useAction()
  const open = draft.statut === 'à valider'

  const act = async (key: string, op: AgenceOp, leave: boolean) => {
    const taken = await run(key, async () => {
      const result = await send(op) as AgenceOpResult
      return result.ok ? null : draftRefusal(result)
    })
    if (taken && leave) onBack()
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
      {draft.incertain && <InlineNotice tone="error" className="!text-primary">Envoi incertain : vérifie le canal Slack avant de renvoyer.</InlineNotice>}
      {error && <InlineNotice tone="error" className="!text-primary">{error}</InlineNotice>}
      {open && (
        <div data-testid="draft-actions" className="flex shrink-0 items-center justify-end gap-1.5">
          <ActionButton className="shrink-0 whitespace-nowrap" busy={active === 'edit'} done={done === 'edit'} disabled={waiting('edit')} onClick={() => void act('edit', { kind: 'draft.edit', draftId: draft.id }, false)}>Modifier</ActionButton>
          <ActionButton className={ACTION_DANGER} busy={active === 'drop'} disabled={waiting('drop')} onClick={() => void act('drop', { kind: 'draft.drop', draftId: draft.id }, true)}>Abandonner</ActionButton>
          <ActionButton className={ACTION} busy={active === 'send'} disabled={waiting('send')} onClick={() => void act('send', { kind: 'draft.send', draftId: draft.id, hash: draft.hash, ...(draft.incertain ? { confirme: true } : {}) }, true)}>{draft.incertain ? 'Envoyer quand même' : 'Envoyer'}</ActionButton>
        </div>
      )}
    </div>
  )
}
