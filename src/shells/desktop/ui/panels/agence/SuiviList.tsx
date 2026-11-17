import { Fragment, type ReactNode } from 'react'
import { clientUi } from '@kernel/interaction'
import type { NeedRow, SuiviView } from '@panels/agence/contract'
import { Button, InlineNotice } from '../../kernel/interaction'

const SECTIONS = [
  { key: 'bloquant', title: 'Bloquant', tone: 'text-danger' },
  { key: 'aFaire', title: 'À faire par Heifara', tone: 'text-warning' },
  { key: 'fait', title: 'Fait', tone: 'text-secondary' },
  { key: 'reste', title: 'Reste à faire', tone: 'text-secondary' },
] as const

const EVIDENCE = 'preuve : '

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => { event.preventDefault(); clientUi().openExternal(href) }}
      className="text-agent underline decoration-agent/30 hover:decoration-agent"
    >
      {children}
    </a>
  )
}

/** One mention of a line: the #N of a PR and a URL as evidence are links. */
function Mention({ item, row }: { item: string; row: NeedRow }) {
  if (row.link && item === row.link.label) return <ExternalLink href={row.link.href}>{item}</ExternalLink>
  if (item.startsWith(EVIDENCE) && /^https?:\/\//.test(item.slice(EVIDENCE.length))) {
    const url = item.slice(EVIDENCE.length)
    return <>{EVIDENCE}<ExternalLink href={url}>{url}</ExternalLink></>
  }
  return <>{item}</>
}

function Row({ row, onRead }: { row: NeedRow; onRead(draftId: string): void }) {
  const action = row.action
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
      </div>
      {row.meta.length > 0 && (
        <div className="mt-0.5 break-words text-[11px] text-muted">
          {row.meta.map((item, index) => (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && ' · '}
              <Mention item={item} row={row} />
            </Fragment>
          ))}
        </div>
      )}
    </li>
  )
}

export default function SuiviList({ suivi, onRead }: { suivi: SuiviView; onRead(draftId: string): void }) {
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
            : <ul>{suivi.sections[key].map((row) => <Row key={row.id} row={row} onRead={onRead} />)}</ul>}
        </section>
      ))}
    </div>
  )
}
