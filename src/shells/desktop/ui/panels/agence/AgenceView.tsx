import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AgenceOp, AgenceOpResult, AgenceSnapshot } from '@panels/agence/contract'
import { Button, InlineNotice, LoadingState } from '../../kernel/interaction'
import type { PanelViewProps } from '../../client/host/views'
import DraftReader from './DraftReader'
import RegisseurBanner from './RegisseurBanner'
import SuiviList from './SuiviList'
import TerminalPane from './TerminalPane'
import { openInCate } from './openLink'

/** Under this width the conversation and the follow-up are tabs, not columns. */
const NARROW_PX = 640

/** The view's width; 0 while unknown (then it is laid out wide). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

type Tab = 'conversation' | 'suivi'

/** The agence panel: the orchestrator's conversation (its terminal) next to the
 *  project's follow-up and the draft being read; tabs when it is narrow. */
export default function AgenceView(props: PanelViewProps<AgenceSnapshot, AgenceOp>) {
  const { workspaceId, panelId, snapshot, send, visible } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const narrow = width > 0 && width < NARROW_PX
  const [tab, setTab] = useState<Tab>('conversation')
  const [reading, setReading] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  /** An op whose refusal is shown above both columns. */
  const run = async (op: AgenceOp) => {
    setRefusal(null)
    try {
      const result = await send(op) as AgenceOpResult
      if (!result.ok) setRefusal(result.message ?? result.error)
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error))
    }
  }

  if (!snapshot) {
    return <div ref={rootRef} className="h-full"><LoadingState label="Loading agence panel" className="h-full p-4 text-xs" /></div>
  }
  const draft = reading ? snapshot.drafts[reading] : undefined
  const orchestratorDown = snapshot.orchestrator === 'exited' || snapshot.orchestrator === 'failed'
  const showConversation = !narrow || tab === 'conversation'
  const showSuivi = !narrow || tab === 'suivi'
  const tabClass = (name: Tab) => `px-3 py-1.5 text-[12px] ${tab === name ? 'text-primary border-b-2 border-focus-blue' : 'text-muted hover:text-primary'}`

  return (
    <div ref={rootRef} className="flex h-full min-w-0 flex-col bg-surface-1">
      {narrow && (
        <div role="tablist" className="flex shrink-0 border-b border-subtle">
          <button type="button" role="tab" aria-selected={tab === 'conversation'} className={tabClass('conversation')} onClick={() => setTab('conversation')}>Conversation</button>
          <button type="button" role="tab" aria-selected={tab === 'suivi'} className={tabClass('suivi')} onClick={() => setTab('suivi')}>Suivi</button>
        </div>
      )}
      {refusal && <InlineNotice tone="error" className="m-3 mb-0 shrink-0">{refusal}</InlineNotice>}
      <div className="flex min-h-0 flex-1">
        <section data-testid="conversation-column" className={`flex min-h-0 min-w-0 flex-col ${showConversation ? (narrow ? 'flex-1' : 'flex-[3] border-r border-subtle') : 'hidden'}`}>
          {orchestratorDown && (
            <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-1.5 text-[12px] text-secondary">
              <span className="min-w-0 flex-1 truncate">{snapshot.orchestrator === 'failed' ? "L'orchestrateur n'a pas démarré." : "L'orchestrateur est arrêté."}</span>
              <Button size="sm" variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => void run({ kind: 'orchestrator.restart' })}>Relancer l&apos;orchestrateur</Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <TerminalPane {...props} visible={visible && showConversation} send={(op) => run(op as AgenceOp)} />
          </div>
        </section>
        <section data-testid="suivi-column" className={`min-h-0 min-w-0 overflow-auto ${showSuivi ? (narrow ? 'flex-1' : 'flex-[2]') : 'hidden'}`}>
          <RegisseurBanner regisseur={snapshot.regisseur} onRestart={() => void run({ kind: 'orchestrator.restart' })} />
          {draft
            ? <DraftReader workspaceId={workspaceId} panelId={panelId} draft={draft} send={send} onBack={() => setReading(null)} />
            : snapshot.suivi
              ? (
                <SuiviList
                  workspaceId={workspaceId}
                  suivi={snapshot.suivi}
                  onRead={setReading}
                  onRebase={(questionId) => void run({ kind: 'answer', questionId, choice: 'rebase' })}
                  onOpenUrl={(url) => { openInCate(workspaceId, panelId, url) }}
                />
              )
              : <div className="p-4 text-[12px] text-muted">Aucun suivi pour l&apos;instant.</div>}
        </section>
      </div>
    </div>
  )
}
