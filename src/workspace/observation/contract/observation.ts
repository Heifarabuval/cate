// One line of the journal: `{ts, kind, panelType, ref}` and nothing else (FR-001,
// spec 003 "Key Entities"). A fact about a panel or a page, never a content.

import { isPanelType, type PanelType } from '@workspace/document/contract'
import { isExcludedDomain, stripUrl } from './rules'

/**
 * The kinds of the socle. `click` and `field` come with the recorder; the
 * line of a terminal command is out of the first lot (Q1).
 */
export const OBSERVATION_KINDS = ['panel.created', 'panel.closed', 'panel.linked', 'navigate'] as const
export type ObservationKind = (typeof OBSERVATION_KINDS)[number]

/** Longest `ref` of a line, in characters. */
export const MAX_REF_LENGTH = 512
/** A URL longer than this is not even parsed. */
const MAX_URL_LENGTH = 8_192

/** What a source tells the journal. */
export interface ObservationInput {
  kind: ObservationKind
  panelType: PanelType
  /** The panel id for `panel.*`, the URL without parameters for `navigate`. */
  ref: string
}

/** A line of the journal. `ts` is an ISO 8601 time in UTC. */
export interface Observation extends ObservationInput {
  ts: string
}

const INPUT_KEYS = ['kind', 'panelType', 'ref'] as const
// The ids of panels name files (`sessions/<panelId>.json`): letters, digits, `.`, `_`, `-`.
const PANEL_REF = /^[A-Za-z0-9._-]{1,128}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isKind = (value: unknown): value is ObservationKind =>
  typeof value === 'string' && (OBSERVATION_KINDS as readonly string[]).includes(value)

export const isIsoTime = (value: string): boolean => ISO_TIME.test(value) && !Number.isNaN(Date.parse(value))

/**
 * What a source may say, made fit for the journal, or null: the exact three
 * fields, a known kind and panel type, an identifier for a panel, and for a
 * navigation the URL without parameters on a domain that is not excluded.
 * Anything else is refused whole, never trimmed: a refused fact is no fact.
 */
export function cleanInput(value: unknown, exclusions: readonly string[]): ObservationInput | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== INPUT_KEYS.length || !INPUT_KEYS.every((key) => keys.includes(key))) return null
  const { kind, panelType, ref } = value
  if (!isKind(kind) || !isPanelType(panelType) || typeof ref !== 'string') return null

  let clean = ref
  if (kind === 'navigate') {
    if (ref.length > MAX_URL_LENGTH) return null
    const url = stripUrl(ref)
    if (url === null || isExcludedDomain(url, exclusions)) return null
    clean = url
  } else if (!PANEL_REF.test(ref)) {
    return null
  }
  if (clean.length === 0 || clean.length > MAX_REF_LENGTH) return null
  return { kind, panelType, ref: clean }
}

/**
 * A line as the journal stores it, or null for a line that is hand-edited,
 * corrupted or not ours. A navigation that carries a parameter or a
 * credential is not a line the journal wrote.
 */
export function parseObservation(value: unknown): Observation | null {
  if (!isRecord(value)) return null
  const { ts, ...rest } = value
  if (typeof ts !== 'string' || !isIsoTime(ts)) return null
  const input = cleanInput(rest, [])
  if (input === null || input.ref !== rest.ref) return null
  return { ts, ...input }
}
