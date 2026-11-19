import { useEffect, useState } from 'react'
import type { GardeState, RegisseurView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, useAction } from './action'
import { ACTION_PLAIN } from './styles'

/** An unknown send guard is said only after this long without a turn of the regisseur. */
const GARDE_INCONNU_MS = 5000

/** What the person must know about the regisseur: why the follow-up cannot be
 *  acted on, and what to do. Nothing while it starts or runs (an CLI settings
 *  hint shows either way: the regisseur runs but `cate` calls are refused).
 *  Also the send guard of `~/.claude/settings.json` when it is not on, the
 *  regisseur being ours (an external or missing one says nothing of it). */
export default function RegisseurBanner({ regisseur, garde, onRestart }: { regisseur: RegisseurView; garde: GardeState; onRestart(): Promise<string | null> }) {
  const restart = useAction()
  const [inconnuLong, setInconnuLong] = useState(false)
  useEffect(() => {
    setInconnuLong(false)
    if (garde !== 'inconnu') return
    const timer = setTimeout(() => setInconnuLong(true), GARDE_INCONNU_MS)
    return () => clearTimeout(timer)
  }, [garde])
  const notices: Array<{ tone: 'warning' | 'error' | 'info'; text: string; restart?: boolean }> = []
  if (regisseur.state === 'missing') {
    notices.push({ tone: 'error', text: `L'outil agence est introuvable ou trop ancien : ${regisseur.error ?? 'agence absente'}` })
  } else if (regisseur.state === 'external') {
    notices.push({ tone: 'info', text: `Un régisseur tient déjà ce dépôt : le suivi est en lecture seule (${regisseur.error ?? 'régisseur externe'}).` })
  } else if (regisseur.state === 'stopped' && regisseur.error) {
    notices.push({ tone: 'warning', text: `Le régisseur est arrêté : ${regisseur.error}`, restart: true })
  }
  if (regisseur.settingsHint) notices.push({ tone: 'warning', text: regisseur.settingsHint })
  if (regisseur.state !== 'external' && regisseur.state !== 'missing') {
    const install = 'un agent peut envoyer un message Slack ou Gmail sans clic sur Envoyer. Dans un terminal : agence hooks install'
    if (garde === 'inactif') notices.push({ tone: 'warning', text: `Garde d'envoi inactif : ${install}` })
    else if (garde === 'partiel') notices.push({ tone: 'warning', text: `Garde d'envoi partiel : ${install}` })
    else if (garde === 'inconnu' && inconnuLong) notices.push({ tone: 'warning', text: "Garde d'envoi inconnu : le régisseur ne l'a pas encore lu. Dans un terminal : agence hooks status" })
  }
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
