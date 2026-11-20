import { useState } from 'react'
import type { ActionsState, BoiteActions, Ligne as LigneData } from '@client/boite'
import { Button, InlineNotice } from '../../kernel/interaction'
import { MarkdownPreview } from '../editor/MarkdownPreview'

/** The action to take (accent tint, primary text), and the plain one: readable in every theme, never wrapped. */
const ACTION = 'shrink-0 whitespace-nowrap font-medium !border-agent !bg-agent/25 !text-primary disabled:!opacity-100'
const PLAIN = 'shrink-0 whitespace-nowrap !text-primary'
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
}

/** A question an agent asked: its options (the first one recommended), then a free answer. */
function QuestionCard({ ligne, actions, busy }: { ligne: LigneData; actions: BoiteActions; busy: boolean }) {
  const [text, setText] = useState('')
  const { action } = ligne
  if (action.type !== 'question') return null
  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-subtle bg-surface-1 p-2">
      {action.options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          data-testid="option"
          disabled={busy}
          onClick={() => void (action.isMerge && index === 0 ? actions.merge(ligne.key) : actions.answer(ligne.key, { choice: index }))}
          className={`${OPTION} ${index === 0 ? 'border-agent' : 'border-subtle'}`}
        >
          <span className="min-w-0 flex-1">
            <b className="block break-words">{index === 0 ? `${option.label} (Recommandé)` : option.label}</b>
            {option.detail && <span className="block break-words text-[11px] text-secondary">{option.detail}</span>}
          </span>
        </button>
      ))}
      <textarea
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Autre réponse"
        placeholder="Autre réponse"
        className="w-full resize-y rounded-md border border-subtle bg-surface-2 p-1.5 text-[12px] text-primary placeholder:text-secondary"
      />
      <div className="flex justify-end">
        <Button size="sm" className={ACTION} disabled={busy || text.trim() === ''} onClick={() => void actions.answer(ligne.key, { libre: text.trim() })}>Répondre</Button>
      </div>
    </div>
  )
}

/** One line: project and age above, the need and its action below, then the
 *  card of the action. Every click goes through `actions` by the line's key. */
export default function Ligne({ ligne, now, actions, state }: LigneProps) {
  const [open, setOpen] = useState(false)
  const { action, key } = ligne
  const age = ageLabel(ligne.waitingSince, now)
  const busy = state.busy.has(key)
  const notice = state.notices[key]
  const shown = state.shown[key] !== undefined && action.type === 'draft' && state.shown[key] === action.hash
  return (
    <li data-testid="ligne" className="flex min-w-0 flex-col gap-0.5 border-b border-subtle px-3 py-2 text-[12px]">
      <div className="flex min-w-0 items-baseline gap-2 text-secondary">
        <span className="min-w-0 truncate">{ligne.repo}</span>
        {age && <span className="ml-auto shrink-0 whitespace-nowrap">{age === "à l'instant" ? age : `depuis ${age}`}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span data-testid="ligne-titre" title={ligne.title} className="min-w-0 flex-1 truncate text-primary">{ligne.title}</span>
        {action.type === 'question' && (
          <Button size="sm" className={ACTION} aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}>
            {action.isMerge ? 'Merger' : 'Répondre'}
          </Button>
        )}
        {action.type === 'draft' && !action.inFlight && !shown && (
          <Button size="sm" className={ACTION} disabled={busy} onClick={() => actions.show(key)}>Lire et envoyer</Button>
        )}
        {action.type === 'draft' && action.inFlight && <span className="shrink-0 whitespace-nowrap text-secondary">En cours d&apos;envoi</span>}
      </div>
      {busy && <div className="text-[11px] text-secondary">Envoi en cours</div>}
      {action.type === 'question' && open && <QuestionCard ligne={ligne} actions={actions} busy={busy} />}
      {action.type === 'draft' && !action.inFlight && shown && (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="relative max-h-64 min-h-[96px] overflow-auto rounded-lg border border-subtle bg-surface-2">
            <MarkdownPreview content={action.texte} workspaceId={ligne.workspaceId} panelId={ligne.panelId} filePath={`${action.draftId}.md`} noImages />
          </div>
          <div className="flex justify-end">
            <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.send(key)}>Envoyer</Button>
          </div>
        </div>
      )}
      {action.type === 'perm' && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-subtle bg-surface-1 p-2">
          <code className="block whitespace-pre-wrap break-all text-[11px] text-primary">{action.command}</code>
          {action.reason && <div className="break-words text-[11px] text-secondary">{action.reason}</div>}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" className={PLAIN} disabled={busy} onClick={() => void actions.perm(key, 'non')}>Non</Button>
            <Button size="sm" className={ACTION} disabled={busy} onClick={() => void actions.perm(key, 'oui')}>Oui</Button>
          </div>
        </div>
      )}
      {notice && <InlineNotice tone="error" className="mt-1 !text-primary">{notice}</InlineNotice>}
    </li>
  )
}
