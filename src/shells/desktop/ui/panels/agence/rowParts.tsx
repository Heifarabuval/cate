import { useId, useState, type ReactNode } from 'react'
import { ChevronRight, CircleDot, GitPullRequest } from 'lucide-react'

/** The ring of every row control: visible on keyboard focus only, on every theme. */
export const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-agent'

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

/** The mentions of a line that are « label : value » (the details), apart from the
 *  one-line notes that explain why an action waits (they stay under the title). */
export interface MetaField { label: string; value: string }
const FIELD = /^(acceptation|preuve|panneau|manque|périmé) : (.*)$/s
const FIELD_BARE = /^(débloque|modifié à) (.*)$/s

export function splitMeta(meta: string[], linkLabel: string | null): { fields: MetaField[]; notes: string[] } {
  const fields: MetaField[] = []
  const notes: string[] = []
  for (const item of meta) {
    if (item === linkLabel) continue
    const found = FIELD.exec(item) ?? FIELD_BARE.exec(item)
    if (found) fields.push({ label: found[1][0].toUpperCase() + found[1].slice(1), value: found[2] })
    else notes.push(item)
  }
  return { fields, notes }
}

/** `#239` of a GitHub PR or issue URL; null for any other URL. */
export function githubRef(url: string): { label: string; pull: boolean } | null {
  const found = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)(?:[/?#]|$)/.exec(url)
  return found ? { label: `#${found[2]}`, pull: found[1] === 'pull' } : null
}

/** A URL short enough for a line: host and path, no scheme. */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

/** A discreet state: neutral pill, a colored dot (the status colors are too pale as text). */
export function StatusPill({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span data-testid="need-status" className="inline-flex items-center gap-1 rounded-full bg-surface-4 px-1.5 py-0.5 text-[11px] leading-none text-secondary">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

/** A PR or an issue as a compact chip « #239 » with its icon; it opens in Cate, never the whole URL. */
export function RefChip({ href, label, pull, onOpen }: { href: string; label: string; pull: boolean; onOpen(url: string): void }) {
  const Icon = pull ? GitPullRequest : CircleDot
  return (
    <a
      href={href}
      title={href}
      data-testid="need-ref"
      onClick={(event) => { event.preventDefault(); onOpen(href) }}
      className={`inline-flex min-h-5 items-center gap-1 rounded-full bg-surface-4 px-1.5 text-[11px] tabular-nums text-primary transition-colors duration-150 hover:bg-surface-5 motion-reduce:transition-none ${FOCUS}`}
    >
      <Icon aria-hidden size={11} />
      {label}
    </a>
  )
}

/** The head of an expandable row: a chevron that turns, then the title, as one button
 *  (Enter and Space are the button's own). Without details it is a plain title. */
export function Disclosure({ title, titleTestId, expanded, controls, onToggle }: { title: string; titleTestId: string; expanded: boolean; controls: string; onToggle?: () => void }) {
  const label = <span data-testid={titleTestId} className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary" title={title}>{title}</span>
  if (!onToggle) return <div className="flex min-h-7 min-w-0 flex-1 items-center gap-1"><span aria-hidden className="w-3.5 shrink-0" />{label}</div>
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={`-ml-1 flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-primary transition-colors duration-150 hover:bg-hover motion-reduce:transition-none ${FOCUS}`}
    >
      <ChevronRight aria-hidden size={14} className={`shrink-0 text-secondary transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
      {label}
    </button>
  )
}

/** The details of a row: labeled fields under a height that opens by itself (grid 0fr to 1fr,
 *  200 ms). Closed, they stay in the page but invisible, so no tab stop lands in them. */
export function Details({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div id={id} className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none ${open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'}`}>
      <div className="min-h-0 overflow-hidden">
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pb-0.5 pl-[18px] pt-1.5">{children}</dl>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[11px] text-secondary">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-[12px] text-primary">{children}</dd>
    </>
  )
}

/** Open state and ids of one expandable row. */
export function useDisclosure() {
  const [open, setOpen] = useState(false)
  return { open, toggle: () => setOpen((value) => !value), id: useId() }
}
