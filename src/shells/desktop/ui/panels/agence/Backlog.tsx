import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { totalLot, type AgenceOp, type AgenceOpResult, type BacklogView, type FicheEtat, type FicheView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import { ACTION } from './styles'

/** The groups in the order the person acts on them; `discussion` is folded. A prête
 *  already in the queue is « En file »: it waits for its place, no click starts it. */
const GROUPES: Array<[FicheEtat | 'enFile', string, string]> = [
  ['prête', 'Prêtes', 'bg-warning'],
  ['enFile', 'En file', 'bg-surface-6'],
  ['lancée', 'Lancées', 'bg-agent'],
  ['discussion', 'Discussion', 'bg-surface-6'],
  ['faite', 'Faites', 'bg-surface-6'],
  ['abandonnée', 'Abandonnées', 'bg-surface-6']
]

/** A group's marker: its state at a glance, the color changes softly when a fiche moves. */
const Dot = ({ className }: { className: string }) => <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${className}`} />

/** 11000 as « 11 000 »; an unknown amount is « inconnu », never 0. */
const jetons = (value: number | null): string => value === null ? 'inconnu' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** What the human launches from « À toi »: a checkbox on each prête and « Lancer (n) ».
 *  « Lancer » sends `fiches.lancer`, the regisseur plans. */
export function LancerPretes({ backlog, send }: { backlog: BacklogView; send(op: AgenceOp): Promise<unknown> }) {
  const [checked, setChecked] = useState<string[]>([])
  const action = useAction()
  const pretes = new Set(backlog.fiches.filter((fiche) => fiche.etat === 'prête' && !backlog.enFile.includes(fiche.id)).map((fiche) => fiche.id))
  // A fiche that left prête (launched elsewhere) is no longer part of the batch.
  const ids = checked.filter((id) => pretes.has(id))
  const toggle = (id: string) => setChecked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const launch = () => void action.run('lancer', async () => {
    const result = await send({ kind: 'fiches.lancer', ids }) as AgenceOpResult
    if (!result.ok) return refusal(result, 'Lancement refusé.')
    setChecked([])
    return null
  })

  const prêtes = backlog.fiches.filter((fiche) => pretes.has(fiche.id))
  if (prêtes.length === 0) return null
  return (
    <section aria-label="Fiches à lancer" className="animate-sidebar-view-in border-t border-subtle px-3 py-2.5 text-[12px] motion-reduce:animate-none">
      <h3 className="mb-1 font-medium text-secondary">{`Fiches prêtes à lancer (${prêtes.length})`}</h3>
      <ul>
        {prêtes.map((fiche) => (
          <li key={fiche.id} className="-mx-1 flex items-center gap-x-2 rounded px-1 py-1 transition-colors duration-150 hover:bg-hover motion-reduce:transition-none">
            <input type="checkbox" className="h-3.5 w-3.5 shrink-0 cursor-pointer text-primary accent-agent" data-fiche={fiche.id} aria-label={`${fiche.id} ${fiche.titre}`} checked={ids.includes(fiche.id)} onChange={() => toggle(fiche.id)} />
            <span className="min-w-0 flex-1 break-words text-primary">{`${fiche.id} ${fiche.titre}`}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center gap-2">
        <ActionButton
          className={ACTION}
          disabled={ids.length === 0 || backlog.erreur !== null}
          busy={action.active === 'lancer'}
          done={action.done === 'lancer'}
          onClick={launch}
        >
          {`Lancer (${ids.length})`}
        </ActionButton>
        {action.error && <span className="min-w-0 break-words text-primary">{action.error}</span>}
      </div>
    </section>
  )
}

/** The backlog the regisseur published: the fiches by state, tokens consumed
 *  on each lancée. State only: what the human does is in « À toi ». */
export default function Backlog({ backlog }: { backlog: BacklogView }) {
  const total = totalLot(backlog.fiches)
  const line = (fiche: FicheView) => (
    <li key={fiche.id} data-testid="fiche" data-fiche={fiche.id} className="flex flex-wrap items-baseline gap-x-2 py-1">
      <span className="min-w-0 flex-1 break-words text-primary">{`${fiche.id} ${fiche.titre}`}{fiche.priorite && <span className="text-secondary">{` · ${fiche.priorite}`}</span>}</span>
      {/* On its own line: a long path beside the title squeezed it to one letter a line. */}
      {backlog.attentes[fiche.id] && fiche.etat === 'prête' && <span data-testid="attend" className="basis-full break-all text-secondary">{`attend : ${backlog.attentes[fiche.id]}`}</span>}
      {fiche.etat === 'lancée' && <span className="shrink-0 text-secondary">{`${jetons(fiche.consomme)} jetons`}</span>}
    </li>
  )

  return (
    <section aria-label="Backlog" className="m-3 mt-0 rounded-lg border border-subtle bg-surface-2 px-3 py-2.5 text-[12px]">
      <h2 className="mb-1 font-semibold text-primary">Backlog</h2>
      {backlog.erreur && <InlineNotice tone="error" className="mb-1.5 !text-primary">{`Backlog invalide : ${backlog.erreur}`}</InlineNotice>}
      {GROUPES.map(([etat, label, dot]) => {
        const queued = (fiche: FicheView) => fiche.etat === 'prête' && backlog.enFile.includes(fiche.id)
        const fiches = backlog.fiches.filter((fiche) => etat === 'enFile' ? queued(fiche) : fiche.etat === etat && !queued(fiche))
        if (fiches.length === 0) return null
        const title = `${label} (${fiches.length})`
        return etat === 'discussion'
          ? (
            <details key={etat} data-testid="groupe" data-etat={etat} className="group mt-2">
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-secondary transition-colors duration-150 hover:text-primary motion-reduce:transition-none">
                <ChevronRight aria-hidden size={12} className="transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" />
                {title}
              </summary>
              <ul className="animate-sidebar-view-in motion-reduce:animate-none">{fiches.map(line)}</ul>
            </details>
          )
          : (
            <div key={etat} data-testid="groupe" data-etat={etat} className="mt-2">
              <h3 className="flex items-center gap-1.5 font-medium text-secondary"><Dot className={dot} />{title}</h3>
              <ul>{fiches.map(line)}</ul>
            </div>
          )
      })}
      {total && <p data-testid="total" className="mt-2 border-t border-subtle pt-2 text-secondary">{`Total des fiches lancées : ${jetons(total.consomme)} jetons`}</p>}
    </section>
  )
}
