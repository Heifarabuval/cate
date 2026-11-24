import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { focusPanel, revealPanel } from '@client/host'
import type { AgenceOp, AgenceOpResult, BacklogView, NeedRow, QuestionView, SuiviView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, ROW_ENTER, ROW_LEAVE, ROW_SHELL, useAction } from './action'
import { LancerPretes } from './Backlog'
import QuestionCard from './QuestionCard'
import { Details, Disclosure, Field, FOCUS, ageLabel, githubRef, RefChip, shortUrl, splitMeta, StatusPill, useDisclosure, type MetaField } from './rowParts'
import { ACTION, LINK } from './styles'
import { useLeaving } from './useLeaving'

const SECTIONS = [
  // `dot` tells the section by a marker: the status colors are too pale as text on a light theme.
  { key: 'aToi', title: 'À toi', dot: 'bg-warning', statut: undefined },
  { key: 'fait', title: 'Fait', dot: 'bg-surface-6', statut: 'fait' },
  { key: 'reste', title: 'Reste à faire', dot: 'bg-surface-6', statut: 'reste' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

/** The rows of a section. « À toi » is the one list of what waits for the human, most urgent
 *  first: what blocks the agents, then what is theirs to do. */
const rowsOf = (suivi: SuiviView, key: SectionKey): NeedRow[] => key === 'aToi' ? [...suivi.sections.bloquant, ...suivi.sections.aFaire] : suivi.sections[key]

/** Opens a URL in Cate (the view decides where). */
type OpenUrl = (url: string) => void

function Link({ href, onOpenUrl, children }: { href: string; onOpenUrl: OpenUrl; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => { event.preventDefault(); onOpenUrl(href) }}
      className={`${LINK} ${FOCUS}`}
    >
      {children}
    </a>
  )
}

/** A panel the line links: a live one comes forward and takes focus; a closed
 *  one shows its last known title, no longer clickable. */
function PanelLink({ workspaceId, link }: { workspaceId: string; link: NeedRow['links'][number] }) {
  if (link.closed) return <span data-testid="closed-panel">{link.title} · fermé</span>
  return (
    <button
      type="button"
      onClick={() => { void revealPanel(workspaceId, link.panelId).then(() => focusPanel(workspaceId, link.panelId)) }}
      className={`max-w-full truncate align-bottom ${LINK} ${FOCUS}`}
    >
      {link.title}
    </button>
  )
}

/** The value of a detail field: the panels it concerns are links, an evidence URL too. */
function FieldValue({ field, row, workspaceId, onOpenUrl }: { field: MetaField; row: NeedRow; workspaceId: string; onOpenUrl: OpenUrl }) {
  if (field.label === 'Panneau' && row.links.length > 0) {
    return (
      <>
        {row.links.map((link, index) => (
          <Fragment key={link.panelId}>
            {index > 0 && ', '}
            <PanelLink workspaceId={workspaceId} link={link} />
          </Fragment>
        ))}
      </>
    )
  }
  if (field.label === 'Preuve' && /^https?:\/\//.test(field.value)) return <Link href={field.value} onOpenUrl={onOpenUrl}>{shortUrl(field.value)}</Link>
  return <>{field.value}</>
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

/** The state a line of a state section wears: « Fait » (« Fermé » once its panels are closed) or « En attente ». */
type Statut = 'fait' | 'reste'

function Row({ row, workspaceId, statut, questions, send, compact, enter: arrived, leaving, onRead, onRebase, onOpenUrl }: { row: NeedRow; workspaceId: string; statut?: Statut; enter: boolean; leaving: boolean } & RowActions) {
  const action = row.action
  const details = useDisclosure()
  const { fields: allFields, notes } = splitMeta(row.meta, row.link?.label ?? null)
  // The PR of a proof is the chip of the line; the other URLs stay a link in the details.
  const proof = allFields.find((field) => field.label === 'Preuve')
  const proofRef = proof ? githubRef(proof.value) : null
  const ref = row.link ? { label: row.link.label, href: row.link.href, pull: row.link.href.includes('/pull/') } : proofRef && proof ? { ...proofRef, href: proof.value } : null
  const fields = proofRef ? allFields.filter((field) => field !== proof) : allFields
  const closed = row.links.length > 0 && row.links.every((link) => link.closed)
  const age = row.created ? ageLabel(row.created, Date.now()) : ''
  const hasMeta = statut !== undefined || ref !== null || age !== ''
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
    <li aria-hidden={leaving || undefined} className={`${ROW_SHELL} border-t border-subtle first:border-t-0 ${leaving ? ROW_LEAVE : ''} ${enter ? ROW_ENTER : ''}`}>
      <div className="min-h-0 overflow-hidden px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Disclosure title={row.title} titleTestId="need-title" expanded={details.open} controls={details.id} onToggle={fields.length > 0 ? details.toggle : undefined} />
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
      {hasMeta && (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[18px] text-[11px] text-secondary">
          {statut && <StatusPill dot={statut === 'reste' ? 'bg-warning' : 'bg-activity-green'}>{statut === 'reste' ? 'En attente' : closed ? 'Fermé' : 'Fait'}</StatusPill>}
          {ref && <RefChip href={ref.href} label={ref.label} pull={ref.pull} onOpen={onOpenUrl} />}
          {age && <span className="whitespace-nowrap tabular-nums">{age === "à l'instant" ? age : `il y a ${age}`}</span>}
        </div>
      )}
      {notes.length > 0 && <div data-testid="need-notes" className="mt-0.5 break-words pl-[18px] text-[11px] text-secondary">{notes.join(' · ')}</div>}
      {fields.length > 0 && (
        <Details id={details.id} open={details.open}>
          {fields.map((field) => (
            <Field key={field.label} label={field.label}><FieldValue field={field} row={row} workspaceId={workspaceId} onOpenUrl={onOpenUrl} /></Field>
          ))}
        </Details>
      )}
      {act.error && !(answering && question) && <InlineNotice tone="error" className="mt-1 !text-primary">{act.error}</InlineNotice>}
      {answering && question && <QuestionCard question={question} send={send} action={act} compact={compact} onDone={() => setAnswering(false)} />}
      </div>
    </li>
  )
}

/** One section: its lines, which fade in when new and fold away when they leave. */
function Section({ title, dot, statut, rows, empty, children, ...rest }: { title: string; dot: string; statut?: Statut; rows: NeedRow[]; empty: string; children?: ReactNode; workspaceId: string } & RowActions) {
  const shown = useLeaving(rows, (row) => row.id)
  return (
    <section className="overflow-hidden rounded-lg border border-subtle bg-surface-2">
      <h2 className="flex items-center gap-2 border-b border-subtle px-3 py-2 text-[12px] font-semibold text-primary">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${dot}`} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="rounded-full bg-surface-4 px-1.5 text-[11px] font-medium tabular-nums text-secondary">{rows.length}</span>
      </h2>
      {shown.length === 0
        ? <div className="flex items-center gap-1.5 px-3 py-2.5 text-[12px] text-secondary"><Check aria-hidden size={12} />{empty}</div>
        : <ul>{shown.map(({ item, entering, leaving }) => <Row key={item.id} row={item} statut={statut} enter={entering} leaving={leaving} {...rest} />)}</ul>}
      {children}
    </section>
  )
}

export default function SuiviList({ workspaceId, suivi, backlog, questions, send, compact, onRead, onRebase, onOpenUrl }: { workspaceId: string; suivi: SuiviView; backlog?: BacklogView | null } & RowActions) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-baseline gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-primary">{suivi.repo}</h1>
        <div className="shrink-0 whitespace-nowrap text-[11px] text-secondary">Agents actifs : {suivi.agentsActive}</div>
      </header>
      {suivi.error && <InlineNotice tone="warning" className="!text-primary">{suivi.error}</InlineNotice>}
      {SECTIONS.map(({ key, title, dot, statut }) => (
        <Section key={key} title={title} dot={dot} statut={statut} rows={rowsOf(suivi, key)} empty={key === 'aToi' ? 'Rien ne t\'attend.' : 'Rien.'} workspaceId={workspaceId} questions={questions} send={send} compact={compact} onRead={onRead} onRebase={onRebase} onOpenUrl={onOpenUrl}>
          {key === 'aToi' && backlog && <LancerPretes backlog={backlog} send={send} />}
        </Section>
      ))}
    </div>
  )
}
