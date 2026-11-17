import { useRef, useState } from 'react'
import { clientUi } from '@kernel/interaction'
import type { AgenceOp, AgenceOpResult, QuestionView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'

type Answer = Extract<AgenceOp, { kind: 'answer' }>

/** What a refusal says, in the regisseur's own words when it gave some. */
function refusal(result: Extract<AgenceOpResult, { ok: false }>): string {
  if (result.error === 'unavailable') return `Régisseur indisponible${result.message ? ` : ${result.message}` : '.'}`
  return result.message ?? 'Réponse refusée.'
}

export interface QuestionCardProps {
  question: QuestionView
  send(op: AgenceOp): Promise<unknown>
  /** The answer was taken: the question leaves the follow-up. */
  onDone(): void
  /** A narrow column: the two buttons under the options take short names
   *  (the full ones stay as title and accessible name) so they fit one line. */
  compact?: boolean
}

/** A question an agent asked: its options (the first one recommended), a free
 *  answer, and for a merge Merger greyed with its reasons, « Merger quand
 *  même » and « Demander le rebase ». The regisseur's `click()` decides: a
 *  refusal shows here, in the card. */
export default function QuestionCard({ question, send, onDone, compact = false }: QuestionCardProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  // Set before React re-renders: a second click in the same batch is ignored,
  // and the lock spans the confirmation dialog too (one dialog at a time).
  const busy = useRef(false)
  const greyed = question.isMerge && question.locks.length > 0

  /** `confirmation`: the question put to the person first; no answer, nothing sent. */
  const answer = async (fields: Omit<Answer, 'kind' | 'questionId'>, confirmation?: string) => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      if (confirmation && !await clientUi().confirm(confirmation)) return
      const result = await send({ kind: 'answer', questionId: question.id, ...fields }) as AgenceOpResult
      if (result.ok) onDone()
      else setError(refusal(result))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  /** Merging over the locks asks first, naming each one it passes over. */
  const mergeAnyway = () => answer({ choice: 0, force: true }, `Merger quand même, malgré :\n${question.locks.map((reason) => `- ${reason}`).join('\n')}`)

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-2">
      <div className="break-words text-[12px] font-medium text-primary">{question.question}</div>
      {question.ghUnknown && <div className="text-[11px] text-muted">état GitHub inconnu</div>}
      {greyed && (
        <div className="text-[11px] text-muted">
          Merger grisé :
          <ul className="list-disc pl-4">{question.locks.map((reason) => <li key={reason} className="break-words">{reason}</li>)}</ul>
        </div>
      )}
      {question.options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          data-testid="option"
          disabled={pending || (index === 0 && greyed)}
          onClick={() => void answer({ choice: index })}
          className={`rounded-md border px-2 py-1.5 text-left text-[12px] disabled:opacity-40 ${index === 0 ? 'border-agent' : 'border-subtle'} hover:bg-hover`}
        >
          <b className="block break-words">{index === 0 ? `${option.label} (Recommandé)` : option.label}</b>
          {option.detail && <span className="block break-words text-[11px] text-muted">{option.detail}</span>}
        </button>
      ))}
      {greyed && (
        <div data-testid="question-actions" className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
          {question.rebase && (
            <Button
              size="sm"
              variant="primary"
              className="shrink-0 whitespace-nowrap"
              disabled={pending}
              onClick={() => void answer({ choice: 'rebase' })}
              {...(compact ? { title: 'Demander le rebase', 'aria-label': 'Demander le rebase' } : {})}
            >
              {compact ? 'Rebase' : 'Demander le rebase'}
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            className="shrink-0 whitespace-nowrap"
            disabled={pending}
            onClick={() => void mergeAnyway()}
            {...(compact ? { title: 'Merger quand même', 'aria-label': 'Merger quand même' } : {})}
          >
            {compact ? 'Forcer' : 'Merger quand même'}
          </Button>
        </div>
      )}
      <textarea
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Autre réponse"
        placeholder="Autre réponse"
        className="w-full resize-y rounded-md border border-subtle bg-surface-2 p-1.5 text-[12px] text-primary"
      />
      <div data-testid={greyed ? undefined : 'question-actions'} className="flex shrink-0 justify-end">
        <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={pending || text.trim() === ''} onClick={() => void answer({ libre: text.trim() })}>Répondre</Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  )
}
