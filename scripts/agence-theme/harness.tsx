// Isolated harness for the agence panel colors: mounts the real components with
// fixtures and applies the theme exactly as the app does (applyTheme). Not part
// of any test suite. Query: ?scene=question|draft|bloquant|merge&theme=<theme id>.
import { createRoot } from 'react-dom/client'
import type { DraftView, NeedRow, QuestionView, SuiviView } from '@panels/agence/contract'
import { applyTheme } from '@shells/desktop/ui/kernel/interaction/theme/themeManager'
import '@shells/desktop/renderer/styles/globals.css'
import QuestionCard from '@shells/desktop/ui/panels/agence/QuestionCard'
import DraftReader from '@shells/desktop/ui/panels/agence/DraftReader'
import SuiviList from '@shells/desktop/ui/panels/agence/SuiviList'
import RegisseurBanner from '@shells/desktop/ui/panels/agence/RegisseurBanner'

const params = new URLSearchParams(location.search)
const scene = params.get('scene') ?? 'question'
applyTheme((params.get('theme') ?? 'dark-warm') as never)

const send = async () => ({ ok: true })
const noop = () => {}

const plain: QuestionView = {
  id: 'q1', question: 'Le rendu est-il lisible dans le thème clair ?', isMerge: false, locks: [], ghUnknown: false, rebase: false,
  options: [
    { label: 'Lisible', detail: 'Les libellés et les descriptions se lisent sur le fond.' },
    { label: 'Encore illisible', detail: 'Corriger encore les couleurs du panneau agence.' },
  ],
}
const merge: QuestionView = {
  id: 'q2', question: 'Merger la PR cate#18 ?', isMerge: true, ghUnknown: false, rebase: true,
  locks: ['conflit avec la base', 'checks ou revue requis'],
  options: [{ label: 'Merger', detail: 'Merge la PR dans main.' }, { label: 'Attendre', detail: 'Laisser la PR ouverte.' }],
}
const draft: DraftView = {
  id: 'd1', cible: 'Heifarabuval/cate#7', kind: 'issue', titre: 'Corriger les couleurs du panneau agence', statut: 'à valider',
  texte: '## Constat\n\nLes libellés sont blancs sur fond clair.\n\n- option **Lisible**\n- option *Encore illisible*', hash: 'abc',
}
const row = (id: string, patch: Partial<NeedRow>): NeedRow => ({ id, title: `Besoin ${id}`, kind: 'task', meta: [], evidence: null, link: null, links: [], action: null, ...patch })
const suivi = (sections: Partial<SuiviView['sections']>): SuiviView => ({
  repo: 'cate', agentsActive: 2, readAt: '2026-11-18T10:00:00Z', error: null,
  sections: { bloquant: [], aFaire: [], fait: [], reste: [], ...sections },
})

const suiviProps = { workspaceId: 'ws', send, onRead: noop, onRebase: noop, onOpenUrl: noop }

function Scene() {
  if (scene === 'draft') return <DraftReader workspaceId="ws" panelId="p" draft={draft} send={send} onBack={noop} />
  if (scene === 'banner') {
    return (
      <div className="flex flex-col gap-3">
        <RegisseurBanner regisseur={{ state: 'stopped', error: 'port 7777 occupé', settingsHint: 'Active cliEnabled dans les réglages.' }} onRestart={noop} />
        <RegisseurBanner regisseur={{ state: 'external', error: null, settingsHint: null }} onRestart={noop} />
        <RegisseurBanner regisseur={{ state: 'missing', error: 'agence absente', settingsHint: null }} onRestart={noop} />
      </div>
    )
  }
  if (scene === 'bloquant') {
    return <SuiviList {...suiviProps} questions={{}} suivi={suivi({
      bloquant: [row('b1', { title: 'Agent cadre bloqué', meta: ['agent bloqué sur une permission ou une question', 'panneau : cadre'] })],
      aFaire: [row('b2', { kind: 'draft', title: 'Brouillon issue #7', action: { type: 'draft', draftId: 'd1', inFlight: false } })],
      reste: [row('b3', { title: 'Relire la PR 18', link: { label: '#18', href: 'https://example.test' }, meta: ['#18', 'débloque cadre'] })],
    })} />
  }
  if (scene === 'merge') {
    return <SuiviList {...suiviProps} questions={{ q2: merge }} suivi={suivi({
      aFaire: [row('m1', { kind: 'human', title: 'Merger la PR cate#18', meta: ['Merger grisé : conflit avec la base'], action: { type: 'question', questionId: 'q2', rebase: true } })],
    })} />
  }
  return <div className="p-3"><QuestionCard question={plain} send={send} onDone={noop} compact={params.get('compact') === '1'} /></div>
}

createRoot(document.getElementById('root')!).render(<div className="bg-surface-1 min-h-screen"><Scene /></div>)
