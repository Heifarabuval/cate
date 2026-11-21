import { useState } from 'react'
import { totalLot, type AgenceOp, type AgenceOpResult, type BacklogView, type FicheEtat, type FicheView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import { ACTION } from './styles'

/** The groups in the order the person acts on them; `discussion` is folded. */
const GROUPES: Array<[FicheEtat, string]> = [
  ['prête', 'Prêtes'],
  ['lancée', 'Lancées'],
  ['discussion', 'Discussion'],
  ['faite', 'Faites'],
  ['abandonnée', 'Abandonnées'],
]

/** 11000 as « 11 000 »; an unknown amount is « inconnu », never 0. */
const jetons = (value: number | null): string => value === null ? 'inconnu' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** The backlog the regisseur published: the fiches by state, a checkbox on each
 *  prête and « Lancer (n) », consumed against budget on each lancée. It reads
 *  nothing and writes nothing: « Lancer » sends `fiches.lancer`, the regisseur plans. */
export default function Backlog({ backlog, send }: { backlog: BacklogView; send(op: AgenceOp): Promise<unknown> }) {
  const [checked, setChecked] = useState<string[]>([])
  const action = useAction()
  const pretes = new Set(backlog.fiches.filter((fiche) => fiche.etat === 'prête').map((fiche) => fiche.id))
  // A fiche that left prête (launched elsewhere) is no longer part of the batch.
  const ids = checked.filter((id) => pretes.has(id))
  const total = totalLot(backlog.fiches)
  const toggle = (id: string) => setChecked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const launch = () => void action.run('lancer', async () => {
    const result = await send({ kind: 'fiches.lancer', ids }) as AgenceOpResult
    if (!result.ok) return refusal(result, 'Lancement refusé.')
    setChecked([])
    return null
  })

  const line = (fiche: FicheView) => (
    <li key={fiche.id} data-testid="fiche" data-fiche={fiche.id} className="flex items-baseline gap-2 py-0.5">
      {fiche.etat === 'prête' && (
        <input type="checkbox" className="shrink-0 text-primary accent-agent" data-fiche={fiche.id} aria-label={`${fiche.id} ${fiche.titre}`} checked={ids.includes(fiche.id)} onChange={() => toggle(fiche.id)} />
      )}
      <span className="min-w-0 flex-1 break-words text-primary">{`${fiche.id} ${fiche.titre}`}{fiche.priorite && <span className="text-secondary">{` · ${fiche.priorite}`}</span>}</span>
      {backlog.attentes[fiche.id] && fiche.etat === 'prête' && <span className="shrink-0 text-secondary">{`attend : ${backlog.attentes[fiche.id]}`}</span>}
      {fiche.etat === 'lancée' && <span className="shrink-0 text-secondary">{`${jetons(fiche.consomme)} / ${jetons(fiche.budgetJetons)} jetons`}</span>}
    </li>
  )

  return (
    <section aria-label="Backlog" className="border-b border-subtle px-3 py-2 text-[12px]">
      <h2 className="mb-1 font-medium text-primary">Backlog</h2>
      {backlog.erreur && <InlineNotice tone="error" className="mb-1.5 !text-primary">{`Backlog invalide : ${backlog.erreur}`}</InlineNotice>}
      {GROUPES.map(([etat, label]) => {
        const fiches = backlog.fiches.filter((fiche) => fiche.etat === etat)
        if (fiches.length === 0) return null
        const title = `${label} (${fiches.length})`
        return etat === 'discussion'
          ? (
            <details key={etat} data-testid="groupe" data-etat={etat} className="mt-1">
              <summary className="cursor-pointer text-secondary hover:text-primary">{title}</summary>
              <ul>{fiches.map(line)}</ul>
            </details>
          )
          : (
            <div key={etat} data-testid="groupe" data-etat={etat} className="mt-1">
              <h3 className="text-secondary">{title}</h3>
              <ul>{fiches.map(line)}</ul>
            </div>
          )
      })}
      {total && <p data-testid="total" className="mt-1 text-secondary">{`Total du lot : ${jetons(total.consomme)} / ${jetons(total.budget)} jetons`}</p>}
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
