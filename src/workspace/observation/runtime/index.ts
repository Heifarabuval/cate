// The observation of one workspace (spec 003): a journal of the gestures the
// socle sees, local, bounded to 14 days, and written only after the person
// accepted. Built by the daemon's composition root with explicit deps; the
// services that produce facts get only `navigated`.

import type { CateServiceHandlers } from '@kernel/api/contract'
import type { Logger } from '@kernel/log/contract'
import { RpcError } from '@kernel/rpc/contract'
import type { CapabilityImpl } from '@kernel/rpc/runtime'
import type { SliceValues } from '@kernel/settings/contract'
import { exclusionList, type ObservationInput, type ObservationState, type observationCapability, type observationSettings, type observeApi } from '../contract'
import { createJournal } from './journal'
import { purgeJournal } from './purge'
import { readJournal, type Listing } from './read'
import { navigationFact, watchDocument, type DocumentSource } from './sources'

export type { Listing } from './read'
export type { DocumentSource } from './sources'

const DAY_MS = 86_400_000

type Values = Pick<
  SliceValues<typeof observationSettings.keys>,
  'observationAccord' | 'observationPause' | 'observationExclusionsAjoutees' | 'observationExclusionsRetirees'
>

/** The workspace settings the observation reads, at every fact. */
export interface ObservationSettings {
  get<K extends keyof Values>(key: K): Values[K]
}

export interface ObservationDeps {
  /** `<data>/observations`. */
  dir: string
  settings: ObservationSettings
  log: Logger
  now?: () => number
  flushDelayMs?: number
  maxQueued?: number
}

export interface ObservationRuntime {
  /** Follows the panels the document creates, closes and links. Returns the way to stop. */
  watchDocument(document: DocumentSource): () => void
  /** A browser panel went to a page. */
  navigated(url: string): void
  state(): ObservationState
  /** The journal of today and of the `jours` days before, read only. */
  list(jours: number): Promise<Listing>
  /** Purges the old files now, then every day. Never rejects. */
  start(): Promise<void>
  flush(): Promise<void>
  dispose(): Promise<void>
}

export function createObservationRuntime(deps: ObservationDeps): ObservationRuntime {
  const { dir, settings, log } = deps
  const now = deps.now ?? Date.now
  // Off until the person accepted; a pause or a withdrawn accord stops it at once.
  const active = (): boolean => settings.get('observationAccord') !== '' && !settings.get('observationPause')
  const journal = createJournal({
    dir,
    now,
    active,
    exclusions: () => exclusionList({ ajoutees: settings.get('observationExclusionsAjoutees'), retirees: settings.get('observationExclusionsRetirees') }),
    log,
    ...(deps.flushDelayMs === undefined ? {} : { flushDelayMs: deps.flushDelayMs }),
    ...(deps.maxQueued === undefined ? {} : { maxQueued: deps.maxQueued }),
  })
  const watchers: Array<() => void> = []
  let daily: ReturnType<typeof setInterval> | null = null

  // A bug here must never reach the document or a panel.
  const observe = (fact: ObservationInput): void => {
    try {
      journal.append(fact)
    } catch (err) {
      log.warn('observation could not take a fact: %s', err instanceof Error ? err.message : String(err))
    }
  }
  const purge = (): Promise<void> => purgeJournal({ dir, now: now(), log }).then(
    () => undefined,
    (err: unknown) => { log.warn('observation purge failed: %s', err instanceof Error ? err.message : String(err)) },
  )

  return {
    watchDocument(document) {
      const off = watchDocument(document, observe, active)
      watchers.push(off)
      return off
    },
    navigated: (url) => observe(navigationFact(url)),
    state() {
      const accord = settings.get('observationAccord')
      const erreur = journal.failure()
      return {
        accord: accord === '' ? null : accord,
        pause: settings.get('observationPause'),
        actif: active() && erreur === null,
        erreur,
      }
    },
    list: (jours) => readJournal({ dir, now: now(), jours, log }),
    async start() {
      if (daily) return
      daily = setInterval(() => { void purge() }, DAY_MS)
      daily.unref()
      await purge()
    },
    flush: () => journal.flush(),
    async dispose() {
      if (daily) clearInterval(daily)
      daily = null
      for (const off of watchers.splice(0)) off()
      await journal.dispose()
    },
  }
}

export function observationCapabilityImpl(service: Pick<ObservationRuntime, 'state'>): CapabilityImpl<typeof observationCapability> {
  return { state: () => service.state() }
}

/** The `service` methods of `cate.observe.*`. */
export function observationApiHandlers(service: Pick<ObservationRuntime, 'list'>): CateServiceHandlers<typeof observeApi> {
  return {
    list: async ({ jours }, ctx) => {
      // A terminal of the machine only: the raw journal never crosses the protocol to a paired device (FR-018).
      if (ctx.caller.kind !== 'cli') {
        throw new RpcError('rejected', 'observation-list-local-only: the journal is read from a terminal of the machine that runs it, never over the network')
      }
      return service.list(jours)
    },
  }
}
