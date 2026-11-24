import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { focusPanel, revealPanel } from '@client/host'
import type { AgenceOp, AgenceOpResult, NeedRow, QuestionView, SuiviView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, ROW_ENTER, useAction } from './action'
import QuestionCard from './QuestionCard'
import { ACTION, LINK } from './styles'

const SECTIONS = [
  // `dot` tells the section by a marker: the status colors are too pale as text on a light theme.
  { key: 'bloquant', title: 'Bloquant', dot: 'bg-danger' },
  { key: 'aFaire', title: 'À faire par {humain}', dot: 'bg-warning' },
  { key: 'fait', title: 'Fait', dot: 'bg-surface-6' },
  { key: 'reste', title: 'Reste à faire', dot: 'bg-surface-6' },
] as const

const EVIDENCE = 'preuve : '

/** Opens a URL in Cate (the view decides where). */
type OpenUrl = (url: string) => void

function Link({ href, onOpenUrl, children }: { href: string; onOpenUrl: OpenUrl; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => { event.preventDefault(); onOpenUrl(href) }}
      className={LINK}
    >
      {children}
    </a>
  )
}

const PANELS = 'panneau : '

/** A panel the line links: a live one comes forward and takes focus; a closed
 *  one shows its last known title, no longer clickable. */
function PanelLink({ workspaceId, link }: { workspaceId: string; link: NeedRow['links'][number] }) {
  if (link.closed) return <span data-testid="closed-panel">{link.title} · fermé</span>
  return (
    <button
      type="button"
      onClick={() => { void revealPanel(workspaceId, link.panelId).then(() => focusPanel(workspaceId, link.panelId)) }}
      className={`max-w-full truncate align-bottom ${LINK}`}
    >
      {link.title}
    </button>
  )
}

/** One mention of a line: the #N of a PR and a URL as evidence are links, and
 *  so are the panels it concerns. */
function Mention({ item, row, workspaceId, onOpenUrl }: { item: string; row: NeedRow; workspaceId: string; onOpenUrl: OpenUrl }) {
  if (item.startsWith(PANELS) && row.links.length > 0) {
    return (
      <>
        {PANELS}
        {row.links.map((link, index) => (
          <Fragment key={link.panelId}>
            {index > 0 && ', '}
            <PanelLink workspaceId={workspaceId} link={link} />
          </Fragment>
        ))}
      </>
    )
  }
  if (row.link && item === row.link.label) return <Link href={row.link.href} onOpenUrl={onOpenUrl}>{item}</Link>
  if (item.startsWith(EVIDENCE) && /^https?:\/\//.test(item.slice(EVIDENCE.length))) {
    const url = item.slice(EVIDENCE.length)
    return <>{EVIDENCE}<Link href={url} onOpenUrl={onOpenUrl}>{url}</Link></>
  }
  return <>{item}</>
}

interface RowActions {
  onRead(draftId: string): void
  /** « Demander le rebase » on a merge greyed by a conflict: the refusal's text, or null when taken. */
  onRebase(questionId: string): Promise<string | null>
  /** A link of the follow-up (#N of a PR or an issue, evidence URL). */
  onOpenUrl: OpenUrl
  /** Open questions by id: a question line offers « Répondre » while its card exists. */
  questions: Record<string, QuestionView>
  send(op: AgenceOp): Promise<unknown>
  /** A narrow column: the buttons under a title take short names (FR-007). */
  compact?: boolean
}

function Row({ row, workspaceId, questions, send, compact, enter: arrived, onRead, onRebase, onOpenUrl }: { row: NeedRow; workspaceId: string; enter: boolean } & RowActions) {
  const action = row.action
  // Latched when the line mounts: a later render of the list does not cut the fade.
  const [enter] = useState(arrived)
  const [answering, setAnswering] = useState(false)
  // One lock per question, shared with its card: the rebase and an answer never run together.
  const act = useAction()
  const question = action?.type === 'question' ? questions[action.questionId] : undefined
  // The line turns to another question: the last check and refusal were about the previous one.
  const questionId = action?.type === 'question' ? action.questionId : null
  const { clear } = act
  useEffect(() => clear(), [questionId]) // eslint-disable-line react-hooks/exhaustive-deps -- `clear` is new each render
  /** An offer of the regisseur (worktree, panel without an agent): one click, its refusal shown on the line. */
  const offer = (key: string, op: AgenceOp) => void act.run(key, async () => {
    const result = await send(op) as AgenceOpResult
    return result.ok ? null : refusal(result, 'Refusé.')
  })
  const offers = action?.type === 'worktree'
    ? [{ key: 'keep', label: 'Garder', op: { kind: 'worktree', needId: row.id, choix: 'keep' } as AgenceOp }, { key: 'remove', label: 'Supprimer', op: { kind: 'worktree', needId: row.id, choix: 'remove' } as AgenceOp }]
    : action?.type === 'orphan'
      ? [{ key: 'keep', label: 'Garder', op: { kind: 'orphan', needId: row.id, choix: 'keep' } as AgenceOp }, { key: 'close', label: 'Fermer', op: { kind: 'orphan', needId: row.id, choix: 'close' } as AgenceOp }]
      : []
  return (
    <li className={`px-3 py-2 border-t border-subtle first:border-t-0 ${enter ? ROW_ENTER : ''}`}>
      <div className="flex items-start gap-2">
        <span data-testid="need-title" className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary" title={row.title}>{row.title}</span>
        {action?.type === 'draft' && (
          <span data-testid="need-actions" className="flex shrink-0 items-center gap-1.5">
            {action.inFlight
              ? <span className="whitespace-nowrap text-[11px] text-secondary">En cours d&apos;envoi</span>
              : <Button size="sm" className={ACTION} onClick={() => onRead(action.draftId)}>Lire et envoyer</Button>}
          </span>
        )}
        {offers.length > 0 && (
          <span data-testid="need-actions" className="flex shrink-0 items-center gap-1.5">
            {offers.map(({ key, label, op }) => (
              <ActionButton key={key} className={ACTION} busy={act.active === key} done={act.done === key} disabled={act.waiting(key)} onClick={() => offer(key, op)}>{label}</ActionButton>
            ))}
          </span>
        )}
        {action?.type === 'question' && (action.rebase || question) && (
          <span data-testid="need-actions" className="flex shrink-0 items-center gap-1.5">
            {action.rebase && (
              <ActionButton
                className={ACTION}
                busy={act.active === 'rebase'}
                done={act.done === 'rebase'}
                disabled={act.waiting('rebase')}
                onClick={() => void act.run('rebase', () => onRebase(action.questionId))}
                {...(compact ? { title: 'Demander le rebase', 'aria-label': 'Demander le rebase' } : {})}
              >
                {compact ? 'Rebase' : 'Demander le rebase'}
              </ActionButton>
            )}
            {question && <ActionButton className={ACTION} done={act.done !== null && act.done !== 'rebase'} disabled={act.active !== null} aria-expanded={answering} onClick={() => setAnswering((open) => !open)}>Répondre</ActionButton>}
          </span>
        )}
      </div>
      {row.meta.length > 0 && (
        <div className="mt-0.5 break-words text-[11px] text-secondary">
          {row.meta.map((item, index) => (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && ' · '}
              <Mention item={item} row={row} workspaceId={workspaceId} onOpenUrl={onOpenUrl} />
            </Fragment>
          ))}
        </div>
      )}
      {act.error && !(answering && question) && <InlineNotice tone="error" className="mt-1 !text-primary">{act.error}</InlineNotice>}
      {answering && question && <QuestionCard question={question} send={send} action={act} compact={compact} onDone={() => setAnswering(false)} />}
    </li>
  )
}

export default function SuiviList({ workspaceId, suivi, questions, send, compact, onRead, onRebase, onOpenUrl }: { workspaceId: string; suivi: SuiviView } & RowActions) {
  // A line is new to its section when it was not there at the last render: it fades in
  // (a line that changes section arrives in the next one, not nowhere). Not on first display.
  const seen = useRef<Set<string> | null>(null)
  const here = SECTIONS.flatMap(({ key }) => suivi.sections[key].map((row) => `${key}/${row.id}`))
  const previous = seen.current
  useEffect(() => { seen.current = new Set(here) })
  return (
    <div className="flex flex-col gap-3 p-3">
      <header>
        <h1 className="truncate text-[15px] font-semibold text-primary">{suivi.repo}</h1>
        <div className="text-[11px] text-secondary">Agents actifs : {suivi.agentsActive}</div>
      </header>
      {suivi.error && <InlineNotice tone="warning" className="!text-primary">{suivi.error}</InlineNotice>}
      {SECTIONS.map(({ key, title, dot }) => (
        <section key={key} className="rounded-lg border border-subtle bg-surface-2">
          <h2 className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-primary border-b border-subtle">
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            {`${title.replace('{humain}', () => suivi.humain)} (${suivi.sections[key].length})`}
          </h2>
          {suivi.sections[key].length === 0
            ? <div className="px-3 py-2 text-[12px] text-secondary">Rien.</div>
            : <ul>{suivi.sections[key].map((row) => <Row key={row.id} row={row} enter={previous !== null && !previous.has(`${key}/${row.id}`)} workspaceId={workspaceId} questions={questions} send={send} compact={compact} onRead={onRead} onRebase={onRebase} onOpenUrl={onOpenUrl} />)}</ul>}
        </section>
      ))}
    </div>
  )
}
