import type { AgenceOp, AgenceOpResult, QuestionView } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import QuestionCard from './QuestionCard'
import { ACTION_PLAIN } from './styles'

/** The panel while the project has no settings file (spec 015): the setup agent runs in a panel of its own and
 *  proposes the settings on cards, shown here with their diff. « Appliquer » writes (the regisseur does), and
 *  the orchestrator starts; « Passer » keeps the defaults. Nothing is asked here: the agent asks. */
export default function SetupEnCours({ questions, disponible, onRestart, send }: {
  questions: QuestionView[]
  /** The regisseur runs: « Passer » and the cards can write. Without it nothing is written, so the
   *  orchestrator waits for a restart. */
  disponible: boolean
  /** Restarts the regisseur, when the banner shows no button for it. */
  onRestart?: () => Promise<string | null>
  send(op: AgenceOp): Promise<unknown>
}) {
  const action = useAction()
  const restart = useAction()
  const passer = () => void action.run('passer', async () => {
    const result = await send({ kind: 'setup.passer' }) as AgenceOpResult
    return result.ok ? null : refusal(result, 'Setup non passé.')
  })
  return (
    <section aria-label="Setup du projet" className="mx-auto flex h-full max-w-lg flex-col justify-center gap-3 p-4 text-[13px]">
      <h2 className="text-[15px] font-medium text-primary">Setup du projet</h2>
      <p className="text-secondary">Un agent prépare les réglages de ce workspace avec vous, dans le panneau « Setup ». Il propose ; rien n&apos;est écrit avant votre clic. L&apos;orchestrateur démarre ensuite.</p>
      {questions.map((question) => <QuestionCard key={question.id} question={question} send={send} action={action} onDone={() => {}} />)}
      {!disponible && (
        <InlineNotice tone="warning" className="!text-primary">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1">Réponses impossibles tant que le régisseur ne tourne pas : relancez-le avec « Relancer le régisseur ».</span>
            {onRestart && <ActionButton className={ACTION_PLAIN} busy={restart.active === 'restart'} onClick={() => void restart.run('restart', onRestart)}>Relancer le régisseur</ActionButton>}
          </div>
        </InlineNotice>
      )}
      {action.error && <InlineNotice tone="error" className="!text-primary">{action.error}</InlineNotice>}
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <ActionButton className={ACTION_PLAIN} disabled={action.active !== null || !disponible} busy={action.active === 'passer'} onClick={passer}>Passer</ActionButton>
      </div>
    </section>
  )
}
