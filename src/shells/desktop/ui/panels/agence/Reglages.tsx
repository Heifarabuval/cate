import { useState } from 'react'
import { clientUi } from '@kernel/interaction'
import { PRESET_DEFAUT, type AgenceOp, type AgenceOpResult, type PratiqueChamp, type PratiquesView, type PratiqueValeur } from '@panels/agence/contract'
import { InlineNotice } from '../../kernel/interaction'
import { ActionButton, refusal, useAction } from './action'
import { ACTION, ACTION_DANGER, ACTION_PLAIN } from './styles'

/** Where a value comes from, in words (spec 008, « Origine »). */
const ORIGINES: Record<string, string> = {
  'défaut': 'par défaut',
  dev: 'vos réglages',
  projet: 'ce workspace',
  ponctuel: 'ponctuel, jusqu\'au prochain démarrage',
}
const INDISPONIBLE = 'Réglages indisponibles : l\'agence ne tourne pas.'

const same = (a: PratiqueValeur, b: PratiqueValeur): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A value in words: the labels of its choices, the `vide` phrase for none. */
export function enMots(champ: PratiqueChamp, value: PratiqueValeur): string {
  if (value === null || (Array.isArray(value) && value.length === 0)) return champ.vide ?? 'Aucun'
  const label = (one: PratiqueValeur) => champ.choix?.find((choix) => same(choix.valeur, one))?.libelle ?? String(one)
  return Array.isArray(value) ? value.map(label).join(', ') : label(value)
}

const CONTROL = 'rounded border border-subtle bg-surface-2 px-1.5 py-0.5 text-[12px] text-primary disabled:opacity-60'

/** The control of a field after its form: a list of named values, a bounded picker,
 *  one box per value of a list, a text field. `onChange` gets the value as published. */
export function ChampControl({ champ, value, disabled, onChange }: { champ: PratiqueChamp; value: PratiqueValeur; disabled: boolean; onChange(value: PratiqueValeur): void }) {
  if (champ.forme === 'liste') {
    const list = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {(champ.choix ?? []).map((choix, index) => (
          <label key={index} className="flex items-center gap-1 text-primary">
            <input
              type="checkbox"
              className="text-primary accent-agent"
              disabled={disabled}
              checked={list.some((one) => same(one, choix.valeur))}
              onChange={(event) => onChange((champ.choix ?? []).map((c) => c.valeur).filter((one) => same(one, choix.valeur) ? event.target.checked : list.some((x) => same(x, one))))}
            />
            {choix.libelle}
          </label>
        ))}
      </div>
    )
  }
  if (champ.forme === 'motif') {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          const text = (event.currentTarget.elements[0] as HTMLInputElement).value.trim()
          onChange(text || null)
        }}
      >
        <input key={String(value)} type="text" aria-label={champ.nom} className={`${CONTROL} min-w-0 flex-1`} disabled={disabled} defaultValue={typeof value === 'string' ? value : ''} placeholder={champ.vide ?? ''} />
        <button type="submit" className={`${CONTROL} hover:text-primary`} disabled={disabled}>Enregistrer</button>
      </form>
    )
  }
  // ponytail: one option per integer of the bounds; a number field if a setting ever spans hundreds.
  const options: PratiqueValeur[] = champ.forme === 'entier' && champ.bornes
    ? Array.from({ length: champ.bornes[1] - champ.bornes[0] + 1 }, (_, index) => champ.bornes![0] + index)
    : (champ.choix ?? []).map((choix) => choix.valeur)
  const selected = options.findIndex((one) => same(one, value))
  return (
    <select aria-label={champ.nom} className={CONTROL} disabled={disabled} value={selected < 0 ? '' : String(selected)} onChange={(event) => onChange(options[Number(event.target.value)])}>
      {selected < 0 && <option value="" disabled>{enMots(champ, value)}</option>}
      {options.map((one, index) => <option key={index} value={String(index)}>{enMots(champ, one)}</option>)}
    </select>
  )
}

export interface ReglagesProps {
  /** Carries the published fields (`champs`). */
  pratiques: PratiquesView
  /** The regisseur runs: writes can go. */
  disponible: boolean
  send(op: AgenceOp): Promise<unknown>
  onClose(): void
}

/** The settings form of the workspace, generated from the fields the regisseur
 *  published: it knows no key. It writes nothing: every change is an op the session
 *  relays to the regisseur, which validates and answers in plain words. */
export default function Reglages({ pratiques, disponible, send, onClose }: ReglagesProps) {
  const action = useAction()
  const [refusee, setRefusee] = useState<string | null>(null)
  const invalide = pratiques.erreur !== null
  const disabled = !disponible || invalide || action.active !== null
  const champs = pratiques.champs ?? []

  const run = (key: string, op: AgenceOp) => void action.run(key, async () => {
    setRefusee(key)
    const result = await send(op) as AgenceOpResult
    if (result.ok) return null
    return result.error === 'unavailable' ? INDISPONIBLE : refusal(result, 'Réglage refusé.')
  })

  const preset = async (id: string, nom: string) => {
    const n = pratiques.nbProjet ?? 0
    if (n > 0 && !await clientUi().confirm(`Le modèle « ${nom} » remplace vos ${n} réglages de ce workspace. Continuer ?`)) return
    run(`preset:${id}`, { kind: 'pratique.preset', nom: id, ...(n > 0 ? { remplacer: true } : {}) })
  }
  const repartir = async () => {
    if (!await clientUi().confirm('Repartir des réglages par défaut ? Le fichier de réglages de ce workspace sera remplacé.')) return
    run('repartir', { kind: 'pratique.preset', nom: PRESET_DEFAUT, remplacer: true })
  }

  const ligne = (champ: PratiqueChamp) => (
    <li key={champ.cle} data-testid="reglage" data-nom={champ.nom} className="border-t border-subtle py-1.5 first:border-t-0">
      <div className="font-medium text-primary">{champ.nom}</div>
      <div className="text-secondary">{champ.explique}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <ChampControl champ={champ} value={champ.valeur} disabled={disabled} onChange={(valeur) => run(champ.cle, { kind: 'pratique.set', cle: champ.cle, valeur })} />
        <span className="text-secondary">{`(${ORIGINES[champ.origine] ?? champ.origine}) · Par défaut : ${enMots(champ, champ.defaut)}`}</span>
        {champ.origine !== 'défaut' && (
          <ActionButton className={ACTION_PLAIN} disabled={disabled} busy={action.active === `unset:${champ.cle}`} onClick={() => run(`unset:${champ.cle}`, { kind: 'pratique.unset', cle: champ.cle })}>
            {`Revenir au défaut (${enMots(champ, champ.defaut)})`}
          </ActionButton>
        )}
      </div>
      {action.error && (refusee === champ.cle || refusee === `unset:${champ.cle}`) && <InlineNotice tone="error" className="mt-1 !text-primary">{action.error}</InlineNotice>}
    </li>
  )

  const essentiels = champs.filter((champ) => champ.groupe === 'essentiel')
  const avances = champs.filter((champ) => champ.groupe !== 'essentiel')
  const presetError = action.error && refusee && (refusee.startsWith('preset:') || refusee === 'repartir')
  return (
    <section aria-label="Réglages" className="px-3 py-2 text-[12px]">
      <div className="mb-1.5 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 font-medium text-primary">Réglages de ce workspace</h2>
        <button type="button" className={`${ACTION_PLAIN} text-secondary hover:text-primary`} onClick={() => clientUi().openSettings('cli')}>Accès des agents à Cate</button>
        <ActionButton className={ACTION_PLAIN} onClick={onClose}>Fermer les réglages</ActionButton>
      </div>
      {!disponible && <InlineNotice tone="error" className="mb-1.5 !text-primary">{INDISPONIBLE}</InlineNotice>}
      {invalide && (
        <InlineNotice tone="error" className="mb-1.5 !text-primary">
          <span>Le fichier de réglages de ce workspace est illisible. </span>
          <ActionButton className={ACTION_DANGER} disabled={!disponible || action.active !== null} busy={action.active === 'repartir'} onClick={() => void repartir()}>Repartir des réglages par défaut</ActionButton>
        </InlineNotice>
      )}
      {presetError && <InlineNotice tone="error" className="mb-1.5 !text-primary">{action.error}</InlineNotice>}
      {(pratiques.presets ?? []).length > 0 && (
        <ul className="mb-2">
          {(pratiques.presets ?? []).map((one) => (
            <li key={one.id} data-testid="preset" data-actif={String(one.actif)} className="flex items-baseline gap-2 py-0.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-primary">{one.nom}</span>
                {one.actif && <span className="text-secondary"> (actif)</span>}
                <span className="text-secondary">{` : ${one.explique}`}</span>
              </span>
              {!one.actif && !invalide && (
                <ActionButton className={ACTION} aria-label={`Appliquer ${one.nom}`} disabled={disabled} busy={action.active === `preset:${one.id}`} onClick={() => void preset(one.id, one.nom)}>
                  {`Appliquer ${one.nom}`}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <ul>{essentiels.map(ligne)}</ul>
      {avances.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-secondary hover:text-primary">Avancé</summary>
          <ul>{avances.map(ligne)}</ul>
        </details>
      )}
      {(pratiques.invariants ?? []).length > 0 && (
        <ul data-testid="invariants" className="mt-2 list-disc pl-4 text-secondary">
          {(pratiques.invariants ?? []).map((text, index) => <li key={index}>{text}</li>)}
        </ul>
      )}
    </section>
  )
}
