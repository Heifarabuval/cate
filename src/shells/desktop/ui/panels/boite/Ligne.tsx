import { Fragment, useEffect, useRef, useState } from 'react'
import { clientUi } from '@kernel/interaction'
import type { ActionsState, BoiteActions, Ligne as LigneData } from '@client/boite'
import { Button, InlineNotice } from '../../kernel/interaction'
import { MarkdownPreview } from '../editor/MarkdownPreview'

/** The action to take (accent tint, primary text), and the plain one: readable in every theme, never wrapped. */
const ACTION = 'shrink-0 whitespace-nowrap font-medium !border-agent !bg-agent/25 !text-primary disabled:!opacity-100'
const PLAIN = 'shrink-0 whitespace-nowrap !text-primary'
const LINK = 'min-w-0 truncate text-left hover:underline'
const OPTION = 'flex w-full items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-[12px] text-primary hover:bg-hover disabled:opacity-60'

/** How long it has waited, coarse: « 30 min », « 2 h », « 2 j »; empty when the time is unknown. */
export function ageLabel(since: string, now: number): string {
  const then = Date.parse(since)
  if (!then) return ''
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} j`
}

interface LigneProps {
  ligne: LigneData
  now: number
  actions: BoiteActions
  state: ActionsState
  /** The line the keyboard acts on. */
  selected?: boolean
}

/** A question an agent asked: its options (the first one recommended), then a free answer. */
function QuestionCard({ ligne, actions, busy }: { ligne: LigneData; actions: BoiteActions; busy: boolean }) {
  const [text, setText] = useState('')
  const { action } = ligne
  if (action.type !== 'question') return null
  const { questionId, locks } = action
  const greyed = action.isMerge && locks.length > 0
  /** The recommended option: the first one still possible, not always the first. */
  const recommended = action.options.findIndex((option) => !option.fait)

  /** Merging over the locks asks first, naming each one it passes over. */
  const mergeAnyway = async () => {
    if (!await clientUi().confirm(`Merger quand même, malgré :\n${locks.map((reason) => `- ${reason}`).join('\n')}`)) return
    await actions.merge(ligne.key, { questionId, force: true })
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-subtle bg-surface-1 p-2">
      {action.ghUnknown && <div className="text-[11px] text-secondary">état GitHub inconnu</div>}
      {action.options.map((option, index) => {
        // Merger greyed: « Merger quand même » takes the option's place, its reasons right above.
        const force = index === 0 && greyed
        if (option.fait) {
          return (
            <div key={option.label} data-testid="option-faite" aria-disabled className="rounded-md border border-subtle px-2 py-1.5 text-secondary">
              <b className="block break-words">{`${option.label} : déjà fait`}</b>
              {option.detail && <span className="block break-words text-[11px]">{option.detail}</span>}
            </div>
          )
        }
        return (
          <Fragment key={option.label}>
            {force && (
              <div className="text-[11px] text-secondary">
                Merger grisé :
                <ul className="list-disc pl-4">{locks.map((reason) => <li key={reason} className="break-words">{reason}</li>)}</ul>
              </div>
            )}
            <button
              type="button"
              data-testid="option"
              disabled={busy}
              onClick={() => void (force ? mergeAnyway() : action.isMerge && index === 0 ? actions.merge(ligne.key, { questionId }) : actions.answer(ligne.key, { questionId, choice: index }))}
              className={`${OPTION} ${force ? 'border-danger' : index === recommended ? 'border-agent' : 'border-subtle'}`}
            >
              <span className="min-w-0 flex-1">
                <b className="block break-words">{force ? 'Merger quand même (rebase)' : index === recommended ? `${option.label} (Recommandé)` : option.label}</b>
                {option.detail && <span className="block break-words text-[11px] text-secondary">{option.detail}</span>}
              </span>
            </button>
          </Fragment>
        )
      })}
      {greyed && action.rebase && (
        <div className="flex justify-end">
          <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.answer(ligne.key, { questionId, choice: 'rebase' })}>Demander le rebase</Button>
        </div>
      )}
      <textarea
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Autre réponse"
        placeholder="Autre réponse"
        className="w-full resize-y rounded-md border border-subtle bg-surface-2 p-1.5 text-[12px] text-primary placeholder:text-secondary"
      />
      <div className="flex justify-end">
        <Button size="sm" className={ACTION} disabled={busy || text.trim() === ''} onClick={() => void actions.answer(ligne.key, { questionId, libre: text.trim() })}>Répondre</Button>
      </div>
    </div>
  )
}

/** One line: project and age above, the need and its action below, then the
 *  card of the action. Every click goes through `actions` by the line's key. */
export default function Ligne({ ligne, now, actions, state, selected = false }: LigneProps) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const element = useRef<HTMLLIElement>(null)
  useEffect(() => { if (selected) element.current?.scrollIntoView?.({ block: 'nearest' }) }, [selected])
  const { action, key } = ligne
  const age = ageLabel(ligne.waitingSince, now)
  const busy = state.busy.has(key)
  const notice = state.notices[key]
  const live = ligne.enabled
  /** A jump or a restart that was refused says so on the line, in the answer's own words. */
  const settle = async (done: Promise<{ ok: boolean; error?: string; message?: string }>) => {
    const result = await done
    setRefusal(result.ok ? null : result.message ?? result.error ?? null)
  }
  const restart = async () => {
    setRestarting(true)
    try { await settle(actions.restart({ workspaceId: ligne.workspaceId, panelId: ligne.panelId })) } finally { setRestarting(false) }
  }
  const shown = state.shown[key] !== undefined && action.type === 'draft' && state.shown[key] === action.hash
  return (
    <li ref={element} data-testid="ligne" aria-selected={selected || undefined} className={`flex min-w-0 flex-col gap-0.5 border-b border-subtle px-3 py-2 text-[12px] ${selected ? 'bg-hover shadow-[inset_2px_0_0] shadow-agent' : ''} ${live ? '' : 'opacity-70'}`}>
      <div className="flex min-w-0 items-baseline gap-2 text-secondary">
        <button type="button" className={LINK} title={ligne.root} onClick={() => void settle(actions.open(key))}>{ligne.repo}</button>
        {age && <span className="ml-auto shrink-0 whitespace-nowrap">{age === "à l'instant" ? age : `depuis ${age}`}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span data-testid="ligne-titre" title={ligne.title} className="min-w-0 flex-1 truncate text-primary">{ligne.title}</span>
        {live && action.type === 'question' && (
          <Button size="sm" className={ACTION} aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}>
            {action.isMerge ? 'Merger' : 'Répondre'}
          </Button>
        )}
        {live && action.type === 'draft' && !action.inFlight && !shown && (
          <Button size="sm" className={ACTION} disabled={busy} onClick={() => actions.show(key)}>Lire et envoyer</Button>
        )}
        {live && action.type === 'draft' && action.inFlight && <span className="shrink-0 whitespace-nowrap text-secondary">En cours d&apos;envoi</span>}
        {live && (action.type === 'worktree' || action.type === 'orphan') && (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" className={PLAIN} disabled={busy} onClick={() => void actions.offer(key, 'keep')}>Garder</Button>
            <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.offer(key, action.type === 'worktree' ? 'remove' : 'close')}>{action.type === 'worktree' ? 'Supprimer' : 'Fermer'}</Button>
          </span>
        )}
      </div>
      {/* No button answers this line from here: it says why it waits. */}
      {ligne.meta.length > 0 && <div data-testid="ligne-raison" className="min-w-0 break-words text-[11px] text-secondary">{ligne.meta.join(' · ')}</div>}
      {ligne.links.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-secondary">
          {ligne.links.map((link) => link.closed
            ? <span key={link.panelId} className="min-w-0 truncate">{`${link.title} · fermé`}</span>
            : <button key={link.panelId} type="button" className={LINK} onClick={() => void settle(actions.open(key, link.panelId))}>{link.title}</button>)}
        </div>
      )}
      {!live && (
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-secondary">
          <span className="min-w-0 flex-1 break-words">{ligne.reason}</span>
          <Button size="sm" className={PLAIN} disabled={restarting} onClick={() => void restart()}>Relancer</Button>
        </div>
      )}
      {busy && <div className="text-[11px] text-secondary">Envoi en cours</div>}
      {live && action.type === 'question' && open && <QuestionCard ligne={ligne} actions={actions} busy={busy} />}
      {live && action.type === 'draft' && !action.inFlight && shown && (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="relative max-h-64 min-h-[96px] overflow-auto rounded-lg border border-subtle bg-surface-2">
            <MarkdownPreview content={action.texte} workspaceId={ligne.workspaceId} panelId={ligne.panelId} filePath={`${action.draftId}.md`} noImages />
          </div>
          <div className="flex justify-end">
            <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.send(key)}>Envoyer</Button>
          </div>
        </div>
      )}
      {live && action.type === 'perm' && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-subtle bg-surface-1 p-2">
          <code className="block whitespace-pre-wrap break-all text-[11px] text-primary">{action.command}</code>
          {action.reason && <div className="break-words text-[11px] text-secondary">{action.reason}</div>}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" className={PLAIN} disabled={busy} onClick={() => void actions.perm(key, 'non')}>Non</Button>
            <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.perm(key, 'oui')}>Oui</Button>
          </div>
        </div>
      )}
      {(notice ?? refusal) && <InlineNotice tone="error" className="mt-1 !text-primary">{notice ?? refusal}</InlineNotice>}
    </li>
  )
}
