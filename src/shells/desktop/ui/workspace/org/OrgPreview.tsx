// Read-only view of orgs: one node per role, one arrow per link, the user's
// clicks marked, the typical task played step by step, defects and cost. All
// the computing is in @workspace/org/contract; this file only draws it.

import { useEffect, useMemo, useState } from 'react'
import { ORG_AGENCY, ORG_DUO, ORG_SOLO, previewOrg, type OrgFile, type OrgPreview as Preview } from '@workspace/org/contract'

export interface OrgChoice {
  id: string
  label: string
  org: OrgFile
}

export const SHIPPED_ORGS: OrgChoice[] = [
  { id: 'solo', label: 'Solo', org: ORG_SOLO },
  { id: 'duo', label: 'Duo', org: ORG_DUO },
  { id: 'agency', label: 'Agency', org: ORG_AGENCY },
]

const NODE = { w: 150, h: 48, gapX: 90, gapY: 24 }
const STEP_MS = 900

function layout(preview: Preview) {
  const at = new Map<string, { x: number; y: number }>()
  preview.path.waves.forEach((roles, w) =>
    roles.forEach((id, i) => at.set(id, { x: w * (NODE.w + NODE.gapX), y: i * (NODE.h + NODE.gapY) })),
  )
  const width = preview.path.waves.length * (NODE.w + NODE.gapX) - NODE.gapX
  const height = Math.max(...preview.path.waves.map((r) => r.length)) * (NODE.h + NODE.gapY) - NODE.gapY
  return { at, width, height }
}

/** Roles working and links clicked at a step of the simulation. */
function highlight(preview: Preview, step: number) {
  const event = step >= 0 ? preview.path.events[step] : undefined
  return {
    roles: new Set(event?.kind === 'work' ? event.roles : []),
    link: event?.kind === 'click' ? event.link : -1,
  }
}

function OrgPane({ choice, memoryCapGb, step }: { choice: OrgChoice; memoryCapGb?: number; step: number }) {
  const { org } = choice
  const preview = useMemo(() => previewOrg(org, { memoryCapGb }), [org, memoryCapGb])
  const { at, width, height } = layout(preview)
  const active = highlight(preview, step)
  const clickOf = (i: number) => org.links[i].click
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3" aria-label={`Org ${choice.label}`}>
      <div className="overflow-auto rounded border border-subtle p-4">
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
            <defs>
              <marker id={`arrow-${choice.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="fill-current text-muted" />
              </marker>
            </defs>
            {org.links.map((l, i) => {
              const a = at.get(l.from)!
              const b = at.get(l.to)!
              const x1 = a.x + NODE.w
              const y1 = a.y + NODE.h / 2
              const x2 = b.x
              const y2 = b.y + NODE.h / 2
              return (
                <g key={i} data-link={i} data-active={active.link === i} className={active.link === i ? 'text-accent' : 'text-muted'}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={active.link === i ? 2 : 1} markerEnd={`url(#arrow-${choice.id})`} />
                  {clickOf(i) !== 'never' && (
                    <circle data-click={clickOf(i)} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r={6} className="fill-current" />
                  )}
                </g>
              )
            })}
          </svg>
          {Object.entries(org.roles).map(([id, role]) => {
            const p = at.get(id)!
            return (
              <div
                key={id}
                data-role={id}
                data-active={active.roles.has(id)}
                className={`absolute flex flex-col justify-center rounded border px-3 text-[12px] ${active.roles.has(id) ? 'border-accent bg-hover text-primary' : 'border-subtle text-secondary'}`}
                style={{ left: p.x, top: p.y, width: NODE.w, height: NODE.h }}
              >
                <span className="truncate font-medium text-primary">{role.name}</span>
                <span className="truncate text-muted">{role.model} · {role.effort}</span>
              </div>
            )
          })}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[12px]" aria-label="Estimated cost">
        <div><dt className="text-muted">Agents at peak</dt><dd data-cost="agents">{preview.cost.peakAgents} / {org.maxAgents}</dd></div>
        <div><dt className="text-muted">Memory</dt><dd data-cost="memory">{preview.cost.memoryGb} GB</dd></div>
        <div><dt className="text-muted">Tokens per task</dt><dd data-cost="tokens">{Math.round(preview.cost.tokens / 1000)}k</dd></div>
      </dl>
      <ul className="flex flex-col gap-1 text-[12px]" aria-label="Defects">
        {preview.defects.length === 0 && <li className="text-muted">No defect.</li>}
        {preview.defects.map((d, i) => <li key={i} data-defect={d.kind} className="text-secondary">{d.message}</li>)}
      </ul>
    </section>
  )
}

export interface OrgPreviewViewProps {
  orgs?: OrgChoice[]
  /** The machine's memory budget for agents, in GB. */
  memoryCapGb?: number
}

export function OrgPreviewView({ orgs = SHIPPED_ORGS, memoryCapGb }: OrgPreviewViewProps) {
  const [left, setLeft] = useState(orgs[0].id)
  const [right, setRight] = useState<string | null>(null)
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const choices = [orgs.find((o) => o.id === left) ?? orgs[0], right ? orgs.find((o) => o.id === right) : undefined].filter(Boolean) as OrgChoice[]
  // The longest path of the two decides when the simulation ends.
  const length = Math.max(...choices.map((c) => previewOrg(c.org).path.events.length))

  useEffect(() => {
    if (!playing) return
    if (step >= length - 1) return void setPlaying(false)
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, step, length])

  const pick = (set: (id: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    setStep(-1)
    setPlaying(false)
  }
  const select = (label: string, value: string, set: (id: string) => void, none?: string) => (
    <select aria-label={label} value={value} onChange={pick(set)} className="rounded border border-subtle bg-transparent px-2 py-1 text-[12px]">
      {none && <option value="">{none}</option>}
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 text-primary">
      <div className="flex items-center gap-2">
        {select('Org', left, setLeft)}
        {select('Compare with', right ?? '', (id) => setRight(id || null), 'Compare with…')}
        <button
          type="button"
          className="rounded bg-hover px-3 py-1 text-[12px]"
          onClick={() => { setStep(-1); setPlaying(true) }}
        >
          Simulate a typical task
        </button>
        <span className="text-[12px] text-muted" data-testid="step">{step >= 0 ? `Step ${step + 1} / ${length}` : ''}</span>
      </div>
      <div className="flex gap-6">
        {choices.map((c) => <OrgPane key={c.id} choice={c} memoryCapGb={memoryCapGb} step={step} />)}
      </div>
    </div>
  )
}
