import type { RegisseurView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, useAction } from './action'
import { ACTION_PLAIN } from './styles'

/** What the person must know about the regisseur: why the follow-up cannot be
 *  acted on, and what to do. Nothing while it starts or runs (an CLI settings
 *  hint shows either way: the regisseur runs but `cate` calls are refused). */
export default function RegisseurBanner({ regisseur, onRestart }: { regisseur: RegisseurView; onRestart(): Promise<string | null> }) {
  const restart = useAction()
  const notices: Array<{ tone: 'warning' | 'error' | 'info'; text: string; restart?: boolean }> = []
  if (regisseur.state === 'missing') {
    notices.push({ tone: 'error', text: `L'outil agence est introuvable ou trop ancien : ${regisseur.error ?? 'agence absente'}` })
  } else if (regisseur.state === 'external') {
    notices.push({ tone: 'info', text: `Un régisseur tient déjà ce dépôt : le suivi est en lecture seule (${regisseur.error ?? 'régisseur externe'}).` })
  } else if (regisseur.state === 'stopped' && regisseur.error) {
    notices.push({ tone: 'warning', text: `Le régisseur est arrêté : ${regisseur.error}`, restart: true })
  }
  if (regisseur.settingsHint) notices.push({ tone: 'warning', text: regisseur.settingsHint })
  if (notices.length === 0) return null
  return (
    <div data-testid="regisseur-banner" className="flex flex-col gap-1.5 p-3 pb-0">
      {notices.map((notice) => (
        <InlineNotice key={notice.text} tone={notice.tone} className="!text-primary">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{notice.text}</span>
            {notice.restart && <ActionButton className={ACTION_PLAIN} busy={restart.active === 'restart'} done={restart.done === 'restart'} onClick={() => void restart.run('restart', onRestart)}>Relancer le régisseur</ActionButton>}
          </div>
        </InlineNotice>
      ))}
    </div>
  )
}
