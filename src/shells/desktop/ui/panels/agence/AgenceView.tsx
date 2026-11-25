import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { openUrlBeside } from '@client/host'
import type { AgenceOp, AgenceOpResult, AgenceSnapshot, PratiqueValeur } from '@panels/agence/contract'
import { InlineNotice, LoadingState } from '../../kernel/interaction'
import { usePanelView } from '../../client/document'
import type { PanelViewProps } from '../../client/host/views'
import { DockResizeHandle } from '../../client/layout/dock'
import { ActionButton, refusal as refusalText, useAction } from './action'
import Backlog from './Backlog'
import DraftReader from './DraftReader'
import Reglages from './Reglages'
import RegisseurBanner from './RegisseurBanner'
import SetupEnCours from './SetupEnCours'
import SuiviList from './SuiviList'
import TerminalPane from './TerminalPane'
import { ACTION } from './styles'

/** Under this width the conversation and the follow-up are tabs, not columns. */
const NARROW_PX = 640
/** Each column keeps at least this width while the separator moves: the
 *  follow-up's buttons need it (FR-007), the conversation's terminal too. */
const MIN_COLUMN_PX = 280
/** Under this width the follow-up's buttons take short names to stay on one line. */
const COMPACT_PX = 380
/** The conversation's share of the width until the person moves the separator. */
const DEFAULT_SPLIT = 0.6

/** The element's width; 0 while unknown (then it is laid out wide, not compact).
 *  `key` changes when the element appears. */
function useWidth(ref: RefObject<HTMLElement | null>, key: unknown = true): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, key])
  return width
}

type Tab = 'conversation' | 'suivi'

const showValue = (value: PratiqueValeur): string => Array.isArray(value) ? value.map(showValue).join(', ') : value === null ? 'aucune' : String(value)

/** The workflow policy the CLI published: its preset and origin on one line, a
 *  banner when the file is invalid, and « Réglages » when the CLI publishes the form
 *  (an older CLI: the value and source of each key when the line is opened). */
function Pratiques({ pratiques, onReglages, onSetup, disponible }: { pratiques: NonNullable<AgenceSnapshot['pratiques']>; onReglages(): void; onSetup(): void; disponible: boolean }) {
  const [open, setOpen] = useState(false)
  const label = `Pratiques : ${pratiques.preset} (${pratiques.sources.preset ?? 'défaut'})`
  const form = pratiques.champs !== undefined
  return (
    <div className="border-b border-subtle px-3 py-2 text-[12px]">
      {pratiques.erreur && <InlineNotice tone="error" className="mb-1.5 !text-primary">{`Politique invalide : ${pratiques.erreur}`}</InlineNotice>}
      <div className="flex items-center gap-2">
        {form
          ? <span className="min-w-0 flex-1 truncate text-secondary">{label}</span>
          : <button type="button" aria-expanded={open} className="min-w-0 flex-1 truncate text-left text-secondary hover:text-primary" onClick={() => setOpen(!open)}>{label}</button>}
        {form && <ActionButton className={ACTION} disabled={!disponible} onClick={onSetup}>Ajuster le setup</ActionButton>}
        {form && <ActionButton className={ACTION} onClick={onReglages}>Réglages</ActionButton>}
      </div>
      {open && !form && (
        <ul className="mt-1 text-secondary">
          {Object.entries(pratiques.valeurs).map(([key, value]) => (
            <li key={key} data-testid="pratique" className="break-words">{`${key} : ${showValue(value)} (${pratiques.sources[key] ?? 'défaut'})`}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The agence panel: the orchestrator's conversation (its terminal) next to the
 *  project's follow-up and the draft being read; tabs when it is narrow. */
export default function AgenceView(props: PanelViewProps<AgenceSnapshot, AgenceOp>) {
  const { workspaceId, panelId, snapshot, send, visible } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const suiviRef = useRef<HTMLElement>(null)
  const width = useWidth(rootRef)
  const suiviWidth = useWidth(suiviRef, snapshot !== null)
  const narrow = width > 0 && width < NARROW_PX
  const compact = suiviWidth > 0 && suiviWidth < COMPACT_PX
  const uid = useId()
  const [tab, setTab] = useState<Tab>('conversation')
  const [reading, setReading] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [reglages, setReglages] = useState(false)
  // The split is what this client shows of the panel (client state), not the document's.
  const [split, setSplit] = usePanelView(workspaceId, panelId, 'split', DEFAULT_SPLIT)
  const splitRef = useRef(split)
  splitRef.current = split
  const widthRef = useRef(width)
  widthRef.current = width

  /** The separator moved by `delta` px: the conversation's share follows, each column keeping its minimum. */
  const resize = useCallback((delta: number) => {
    const total = widthRef.current
    if (total < 2 * MIN_COLUMN_PX) return
    const least = MIN_COLUMN_PX / total
    const next = Math.min(Math.max(splitRef.current + delta / total, least), 1 - least)
    splitRef.current = next
    setSplit(next)
  }, [setSplit])

  /** An op whose refusal is shown above both columns; resolves to it, `null` when taken. */
  const run = async (op: AgenceOp): Promise<string | null> => {
    setRefusal(null)
    let refused: string | null = null
    try {
      const result = await send(op) as AgenceOpResult
      if (!result.ok) refused = refusalText(result, 'Action refusée.')
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error)
    }
    setRefusal(refused)
    return refused
  }
  const restart = useAction()

  if (!snapshot) {
    return <div ref={rootRef} className="h-full"><LoadingState label="Loading agence panel" className="h-full p-4 text-xs" /></div>
  }
  // The setup holds the orchestrator (the session waits for it): it takes the whole panel.
  if (snapshot.pratiques?.projet === false && snapshot.pratiques.champs) {
    return (
      <div ref={rootRef} className="flex h-full min-w-0 flex-col overflow-auto bg-surface-1">
        <RegisseurBanner regisseur={snapshot.regisseur} garde={snapshot.garde} onRestart={() => run({ kind: 'orchestrator.restart' })} />
        <SetupEnCours
          questions={Object.values(snapshot.questions)}
          disponible={snapshot.regisseur.state === 'running'}
          // The banner carries the restart button only for a regisseur stopped with a reason.
          onRestart={snapshot.regisseur.state === 'stopped' && !snapshot.regisseur.error ? () => run({ kind: 'orchestrator.restart' }) : undefined}
          send={send}
        />
      </div>
    )
  }
  const draft = reading ? snapshot.drafts[reading] : undefined
  const orchestratorDown = snapshot.orchestrator === 'exited' || snapshot.orchestrator === 'failed'
  const showConversation = !narrow || tab === 'conversation'
  const showSuivi = !narrow || tab === 'suivi'
  const tabClass = (name: Tab) => `-mb-px px-3 py-2 text-[12px] transition-colors duration-150 motion-reduce:transition-none ${tab === name ? 'border-b-2 border-focus-blue text-primary' : 'border-b-2 border-transparent text-secondary hover:text-primary'}`
  const ids = (name: Tab) => ({ tab: `${uid}-tab-${name}`, panel: `${uid}-panel-${name}` })
  const panelProps = (name: Tab) => ({
    id: ids(name).panel,
    ...(narrow ? { role: 'tabpanel' as const, 'aria-labelledby': ids(name).tab } : {}),
  })
  const tabButton = (name: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={ids(name).tab}
      aria-selected={tab === name}
      aria-controls={ids(name).panel}
      className={tabClass(name)}
      onClick={() => setTab(name)}
    >
      {label}
    </button>
  )

  return (
    <div ref={rootRef} className="flex h-full min-w-0 flex-col bg-surface-1">
      {narrow && (
        <div role="tablist" className="flex shrink-0 border-b border-subtle">
          {tabButton('conversation', 'Conversation')}
          {tabButton('suivi', 'Suivi')}
        </div>
      )}
      {refusal && <InlineNotice tone="error" className="m-3 mb-0 shrink-0 !text-primary">{refusal}</InlineNotice>}
      <div className="flex min-h-0 flex-1">
        <section
          data-testid="conversation-column"
          {...panelProps('conversation')}
          className={`flex min-h-0 min-w-0 flex-col ${showConversation ? (narrow ? 'flex-1' : 'shrink-0 grow-0') : 'hidden'}`}
          style={narrow ? undefined : { flexGrow: 0, flexShrink: 0, flexBasis: `${Math.round(split * 1000) / 10}%` }}
        >
          {orchestratorDown && (
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1.5 text-[12px] text-secondary">
              <span className="min-w-0 flex-1 truncate">{snapshot.orchestrator === 'failed' ? "L'orchestrateur n'a pas démarré." : "L'orchestrateur est arrêté."}</span>
              <ActionButton className={ACTION} busy={restart.active === 'restart'} done={restart.done === 'restart'} onClick={() => void restart.run('restart', () => run({ kind: 'orchestrator.restart' }))}>Relancer l&apos;orchestrateur</ActionButton>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <TerminalPane {...props} visible={visible && showConversation} send={(op) => run(op as AgenceOp)} />
          </div>
        </section>
        {!narrow && (
          <div role="separator" aria-orientation="vertical" aria-label="Redimensionner la conversation et le suivi" className="flex shrink-0">
            <DockResizeHandle direction="horizontal" onResize={resize} onDoubleClick={() => setSplit(DEFAULT_SPLIT)} />
          </div>
        )}
        <section
          ref={suiviRef}
          data-testid="suivi-column"
          {...panelProps('suivi')}
          className={`min-h-0 min-w-0 overflow-auto ${showSuivi ? 'flex-1' : 'hidden'}`}
        >
          <RegisseurBanner regisseur={snapshot.regisseur} garde={snapshot.garde} onRestart={() => run({ kind: 'orchestrator.restart' })} />
          {snapshot.pratiques && !reglages && <Pratiques pratiques={snapshot.pratiques} onReglages={() => setReglages(true)} onSetup={() => void run({ kind: 'setup.ouvrir' })} disponible={snapshot.regisseur.state === 'running'} />}
          {snapshot.pratiques?.champs && reglages
            ? <Reglages pratiques={snapshot.pratiques} disponible={snapshot.regisseur.state === 'running'} send={send} onClose={() => setReglages(false)} />
            : <>
          {draft
            ? <DraftReader workspaceId={workspaceId} panelId={panelId} draft={draft} send={send} onBack={() => setReading(null)} />
            : snapshot.suivi
              ? (
                <SuiviList
                  workspaceId={workspaceId}
                  suivi={snapshot.suivi}
                  backlog={snapshot.backlog}
                  questions={snapshot.questions}
                  send={send}
                  compact={compact}
                  onRead={setReading}
                  onRebase={async (questionId) => {
                    const result = await send({ kind: 'answer', questionId, choice: 'rebase' }) as AgenceOpResult
                    return result.ok ? null : refusalText(result, 'Réponse refusée.')
                  }}
                  onOpenUrl={(url) => { openUrlBeside(workspaceId, panelId, url) }}
                />
              )
              : <div className="p-4 text-[12px] text-secondary">Aucun suivi pour l&apos;instant.</div>}
          {snapshot.backlog && !draft && <Backlog backlog={snapshot.backlog} />}
            </>}
        </section>
      </div>
    </div>
  )
}
