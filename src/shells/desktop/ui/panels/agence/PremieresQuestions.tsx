import { useState } from 'react'
import type { AgenceOp, AgenceOpResult, PratiqueChamp, PratiqueValeur } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import { ChampControl } from './Reglages'
import { ACTION, ACTION_PLAIN } from './styles'

/** The first questions of a workspace without a settings file (spec 008, US3): the
 *  essential fields that carry a question, one per screen, in the order published,
 *  the current answer preselected. « Terminer » sends every answer at once, « Passer »
 *  keeps the defaults; the session then starts the orchestrator. */
export default function PremieresQuestions({ champs, send }: { champs: PratiqueChamp[]; send(op: AgenceOp): Promise<unknown> }) {
  const questions = champs.filter((champ) => champ.groupe === 'essentiel' && champ.question)
  const [index, setIndex] = useState(0)
  const [reponses, setReponses] = useState<Record<string, PratiqueValeur>>(() => Object.fromEntries(questions.map((champ) => [champ.cle, champ.valeur])))
  const action = useAction()
  const finish = (key: string, op: AgenceOp) => void action.run(key, async () => {
    const result = await send(op) as AgenceOpResult
    return result.ok ? null : refusal(result, 'Réponses refusées.')
  })

  const champ = questions[Math.min(index, questions.length - 1)]
  const last = index >= questions.length - 1
  const answer = (valeur: PratiqueValeur) => setReponses({ ...reponses, [champ.cle]: valeur })
  const busy = action.active !== null
  return (
    <section aria-label="Premières questions" className="mx-auto flex h-full max-w-lg flex-col justify-center gap-3 p-4 text-[13px]">
      {champ && (
        <>
          <div className="text-[12px] text-secondary">{`${index + 1} sur ${questions.length}`}</div>
          <h2 className="text-[15px] font-medium text-primary">{champ.question}</h2>
          <p className="text-secondary">{champ.explique}</p>
          {champ.forme === 'valeurs'
            ? (
              <div role="radiogroup" aria-label={champ.question ?? champ.nom} className="flex flex-col gap-1">
                {(champ.choix ?? []).map((choix, n) => (
                  <label key={n} className="flex items-center gap-2 text-primary">
                    <input
                      type="radio"
                      name={`question-${index}`}
                      className="text-primary accent-agent"
                      checked={JSON.stringify(choix.valeur) === JSON.stringify(reponses[champ.cle])}
                      onChange={() => answer(choix.valeur)}
                    />
                    {choix.libelle}
                  </label>
                ))}
              </div>
            )
            : <ChampControl champ={champ} value={reponses[champ.cle] ?? null} disabled={busy} onChange={answer} />}
        </>
      )}
      {action.error && <InlineNotice tone="error" className="!text-primary">{action.error}</InlineNotice>}
      <div className="flex items-center gap-2">
        {index > 0 && <ActionButton className={ACTION_PLAIN} disabled={busy} onClick={() => setIndex(index - 1)}>Précédent</ActionButton>}
        <span className="flex-1" />
        <ActionButton className={ACTION_PLAIN} disabled={busy} busy={action.active === 'passer'} onClick={() => finish('passer', { kind: 'pratique.questions', passer: true })}>Passer</ActionButton>
        {champ && (last
          ? <ActionButton className={ACTION} disabled={busy} busy={action.active === 'terminer'} onClick={() => finish('terminer', { kind: 'pratique.questions', reponses })}>Terminer</ActionButton>
          : <ActionButton className={ACTION} disabled={busy} onClick={() => setIndex(index + 1)}>Suivant</ActionButton>)}
      </div>
    </section>
  )
}
