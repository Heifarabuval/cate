import { Fragment, useState, type ReactNode } from 'react'
import { focusPanel, revealPanel } from '@client/host'
import type { AgenceOp, NeedRow, QuestionView, SuiviView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'
import QuestionCard from './QuestionCard'

const SECTIONS = [
  { key: 'bloquant', title: 'Bloquant', tone: 'text-danger' },
  { key: 'aFaire', title: 'À faire par Heifara', tone: 'text-warning' },
  { key: 'fait', title: 'Fait', tone: 'text-secondary' },
  { key: 'reste', title: 'Reste à faire', tone: 'text-secondary' },
] as const

const EVIDENCE = 'preuve : '

/** Opens a URL in Cate (the view decides where). */
type OpenUrl = (url: string) => void

function Link({ href, onOpenUrl, children }: { href: string; onOpenUrl: OpenUrl; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => { event.preventDefault(); onOpenUrl(href) }}
      className="text-agent underline decoration-agent/30 hover:decoration-agent"
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
      className="max-w-full truncate align-bottom text-agent underline decoration-agent/30 hover:decoration-agent"
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
  /** « Demander le rebase » on a merge greyed by a conflict. */
  onRebase(questionId: string): void
  /** A link of the follow-up (#N of a PR or an issue, evidence URL). */
  onOpenUrl: OpenUrl
  /** Open questions by id: a question line offers « Répondre » while its card exists. */
  questions: Record<string, QuestionView>
  send(op: AgenceOp): Promise<unknown>
}

function Row({ row, workspaceId, questions, send, onRead, onRebase, onOpenUrl }: { row: NeedRow; workspaceId: string } & RowActions) {
  const action = row.action
  const [answering, setAnswering] = useState(false)
  const question = action?.type === 'question' ? questions[action.questionId] : undefined
  return (
    <li className="px-3 py-2 border-t border-subtle first:border-t-0">
      <div className="flex items-start gap-2">
        <span data-testid="need-title" className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary" title={row.title}>{row.title}</span>
        {action?.type === 'draft' && (
          <span data-testid="need-actions" className="flex shrink-0 items-center gap-1.5">
            {action.inFlight
              ? <span className="whitespace-nowrap text-[11px] text-muted">En cours d&apos;envoi</span>
              : <Button size="sm" variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => onRead(action.draftId)}>Lire et envoyer</Button>}
          </span>
        )}
        {action?.type === 'question' && (action.rebase || question) && (
          <span data-testid="need-actions" className="flex shrink-0 items-center gap-1.5">
            {action.rebase && <Button size="sm" variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => onRebase(action.questionId)}>Demander le rebase</Button>}
            {question && <Button size="sm" variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => setAnswering((open) => !open)}>Répondre</Button>}
          </span>
        )}
      </div>
      {row.meta.length > 0 && (
        <div className="mt-0.5 break-words text-[11px] text-muted">
          {row.meta.map((item, index) => (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && ' · '}
              <Mention item={item} row={row} workspaceId={workspaceId} onOpenUrl={onOpenUrl} />
            </Fragment>
          ))}
        </div>
      )}
      {answering && question && <QuestionCard question={question} send={send} onDone={() => setAnswering(false)} />}
    </li>
  )
}

export default function SuiviList({ workspaceId, suivi, questions, send, onRead, onRebase, onOpenUrl }: { workspaceId: string; suivi: SuiviView } & RowActions) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <header>
        <h1 className="truncate text-[15px] font-semibold text-primary">{suivi.repo}</h1>
        <div className="text-[11px] text-muted">Agents actifs : {suivi.agentsActive}</div>
      </header>
      {suivi.error && <InlineNotice tone="warning">{suivi.error}</InlineNotice>}
      {SECTIONS.map(({ key, title, tone }) => (
        <section key={key} className="rounded-lg border border-subtle bg-surface-2">
          <h2 className={`px-3 py-1.5 text-[12px] font-semibold border-b border-subtle ${tone}`}>{`${title} (${suivi.sections[key].length})`}</h2>
          {suivi.sections[key].length === 0
            ? <div className="px-3 py-2 text-[12px] text-muted">Rien.</div>
            : <ul>{suivi.sections[key].map((row) => <Row key={row.id} row={row} workspaceId={workspaceId} questions={questions} send={send} onRead={onRead} onRebase={onRebase} onOpenUrl={onOpenUrl} />)}</ul>}
        </section>
      ))}
    </div>
  )
}
