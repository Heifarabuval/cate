import type { Ligne as LigneData } from '@client/boite'

/** What the line waits for from the human. */
function actionLabel({ action }: LigneData): string {
  if (action.type === 'draft') return 'Envoyer'
  if (action.type === 'question') return action.isMerge ? 'Merger' : 'Répondre'
  return 'Voir'
}

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

/** One line: project and age above, the need and its expected action below. Read only. */
export default function Ligne({ ligne, now }: { ligne: LigneData; now: number }) {
  const age = ageLabel(ligne.waitingSince, now)
  return (
    <li data-testid="ligne" className="flex min-w-0 flex-col gap-0.5 border-b border-subtle px-3 py-2 text-[12px]">
      <div className="flex min-w-0 items-baseline gap-2 text-secondary">
        <span className="min-w-0 truncate">{ligne.repo}</span>
        {age && <span className="ml-auto shrink-0 whitespace-nowrap">{age === "à l'instant" ? age : `depuis ${age}`}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span data-testid="ligne-titre" title={ligne.title} className="min-w-0 flex-1 truncate text-primary">{ligne.title}</span>
        <span className="shrink-0 whitespace-nowrap rounded border border-agent bg-agent/25 px-1.5 py-0.5 font-medium text-primary">{actionLabel(ligne)}</span>
      </div>
    </li>
  )
}
