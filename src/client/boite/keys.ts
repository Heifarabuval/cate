// The inbox's keyboard, as a pure function: a command (what the key means) and
// the list's state give what to do. The result names a line by its key, never
// its position, so a list that reorders between two presses cannot redirect it.

export type BoiteCommand = 'next' | 'previous' | 'open' | 'send' | 'skip'

export type KeyOutcome =
  | { type: 'select'; key: string }
  | { type: 'show'; key: string }
  | { type: 'send'; key: string }

/** The part of a line the keyboard reads. */
export interface KeyRow {
  key: string
  action: { type: 'draft'; hash: string; inFlight: boolean } | { type: string }
}

export interface KeyState {
  rows: readonly KeyRow[]
  selectedKey: string | null
  /** The hash of the text each line displayed. */
  shown: Readonly<Record<string, string>>
}

export function keyOutcome(command: BoiteCommand, { rows, selectedKey, shown }: KeyState): KeyOutcome | null {
  const index = rows.findIndex((row) => row.key === selectedKey)
  if (command === 'next' || command === 'skip' || command === 'previous') {
    if (rows.length === 0) return null
    const target = index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + (command === 'previous' ? -1 : 1)))
    return { type: 'select', key: rows[target].key }
  }
  const row = rows[index]
  if (!row || row.action.type !== 'draft') return null
  const draft = row.action as Extract<KeyRow['action'], { type: 'draft' }>
  if (command === 'open') return { type: 'show', key: row.key }
  // Send only what was displayed; otherwise the press displays it.
  if (shown[row.key] !== draft.hash) return { type: 'show', key: row.key }
  return draft.inFlight ? null : { type: 'send', key: row.key }
}
