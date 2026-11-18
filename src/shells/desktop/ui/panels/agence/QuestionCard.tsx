import { Fragment, useState } from 'react'
import { clientUi } from '@kernel/interaction'
import type { AgenceOp, AgenceOpResult, QuestionView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, type ActionState } from './action'
import { ACTION } from './styles'

type Answer = Extract<AgenceOp, { kind: 'answer' }>

export interface QuestionCardProps {
  question: QuestionView
  send(op: AgenceOp): Promise<unknown>
  /** The lock of the question, shared with its line: one answer at a time. */
  action: ActionState
  /** The answer was taken: the question leaves the follow-up. */
  onDone(): void
  /** A narrow column: the two buttons under the options take short names
   *  (the full ones stay as title and accessible name) so they fit one line. */
  compact?: boolean
}

/** A question an agent asked: its options (the first one recommended), a free
 *  answer, and for a merge Merger greyed with its reasons, « Merger quand
 *  même » (in the place of the greyed option) and « Demander le rebase ». The regisseur's `click()` decides: a
 *  refusal shows here, in the card. */
export default function QuestionCard({ question, send, action: { run, active, error, waiting }, onDone, compact = false }: QuestionCardProps) {
  const [text, setText] = useState('')
  const greyed = question.isMerge && question.locks.length > 0

  /** `key` names the button; `confirmation`: the question put to the person first; no answer, nothing sent. */
  const answer = async (key: string, fields: Omit<Answer, 'kind' | 'questionId'>, confirmation?: string) => {
    const taken = await run(key, async () => {
      if (confirmation && !await clientUi().confirm(confirmation)) return undefined
      const result = await send({ kind: 'answer', questionId: question.id, ...fields }) as AgenceOpResult
      return result.ok ? null : refusal(result, 'Réponse refusée.')
    })
    if (taken) onDone()
  }

  /** Merging over the locks asks first, naming each one it passes over. */
  const mergeAnyway = () => answer('force', { choice: 0, force: true }, `Merger quand même, malgré :\n${question.locks.map((reason) => `- ${reason}`).join('\n')}`)

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-2">
      <div className="break-words text-[12px] font-medium text-primary">{question.question}</div>
      {question.ghUnknown && <div className="text-[11px] text-secondary">état GitHub inconnu</div>}
      {question.options.map((option, index) => {
        // Merger greyed: « Merger quand même » takes the option's place, same card, its reasons right above.
        const force = index === 0 && greyed
        const key = force ? 'force' : `option-${index}`
        return (
          <Fragment key={option.label}>
            {force && (
              <div className="text-[11px] text-secondary">
                Merger grisé :
                <ul className="list-disc pl-4">{question.locks.map((reason) => <li key={reason} className="break-words">{reason}</li>)}</ul>
              </div>
            )}
            <ActionButton
              bare
              data-testid="option"
              busy={active === key}
              disabled={waiting(key)}
              onClick={() => void (force ? mergeAnyway() : answer(key, { choice: index }))}
              className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-[12px] text-primary disabled:opacity-100 aria-busy:bg-hover ${force ? 'border-danger' : index === 0 ? 'border-agent' : 'border-subtle'} hover:bg-hover disabled:hover:bg-transparent`}
            >
              <span className="min-w-0 flex-1">
                <b className="block break-words text-primary">{force ? 'Merger quand même (rebase)' : index === 0 ? `${option.label} (Recommandé)` : option.label}</b>
                {option.detail && <span className="block break-words text-[11px] text-secondary">{option.detail}</span>}
              </span>
            </ActionButton>
          </Fragment>
        )
      })}
      {greyed && question.rebase && (
        <div data-testid="question-actions" className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
          <ActionButton
            className={ACTION}
            busy={active === 'rebase'}
            disabled={waiting('rebase')}
            onClick={() => void answer('rebase', { choice: 'rebase' })}
            {...(compact ? { title: 'Demander le rebase', 'aria-label': 'Demander le rebase' } : {})}
          >
            {compact ? 'Rebase' : 'Demander le rebase'}
          </ActionButton>
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
      <div data-testid={greyed && question.rebase ? undefined : 'question-actions'} className="flex shrink-0 justify-end">
        <ActionButton className={ACTION} busy={active === 'libre'} disabled={waiting('libre') || text.trim() === ''} onClick={() => void answer('libre', { libre: text.trim() })}>Répondre</ActionButton>
      </div>
      {error && <InlineNotice tone="error" className="!text-primary">{error}</InlineNotice>}
    </div>
  )
}
