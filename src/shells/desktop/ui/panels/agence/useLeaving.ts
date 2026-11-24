import { useEffect, useReducer, useRef } from 'react'

/** How long a line that left the list stays to fold away (matches `ROW_LEAVE`). */
const LEAVE_MS = 200

export interface Shown<T> {
  item: T
  /** The line left the list: it stays LEAVE_MS, folding, then goes. */
  leaving: boolean
  /** The line is new since the last render (never on the first display). */
  entering: boolean
}

/** The lines to draw for a list that changes under the reader: a line that
 *  disappears folds away in place instead of cutting, a new one fades in. The
 *  departed line is kept from the very render that drops it: no flash. */
export function useLeaving<T>(items: T[], keyOf: (item: T) => string): Shown<T>[] {
  const previous = useRef<T[] | null>(null)
  const held = useRef(new Map<string, { item: T; index: number; timer?: ReturnType<typeof setTimeout> }>())
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  const before = previous.current
  const keys = new Set(items.map(keyOf))
  before?.forEach((item, index) => {
    const key = keyOf(item)
    if (!keys.has(key) && !held.current.has(key)) held.current.set(key, { item, index })
  })
  for (const key of keys) {
    const back = held.current.get(key)
    if (back) { clearTimeout(back.timer); held.current.delete(key) }
  }
  useEffect(() => {
    previous.current = items
    held.current.forEach((entry, key) => {
      entry.timer ??= setTimeout(() => { held.current.delete(key); refresh() }, LEAVE_MS)
    })
  })
  useEffect(() => () => held.current.forEach((entry) => clearTimeout(entry.timer)), [])
  const shown: Shown<T>[] = items.map((item) => ({
    item,
    leaving: false,
    entering: before !== null && !before.some((old) => keyOf(old) === keyOf(item))
  }))
  for (const { item, index } of [...held.current.values()].sort((a, b) => a.index - b.index)) {
    shown.splice(Math.min(index, shown.length), 0, { item, leaving: true, entering: false })
  }
  return shown
}
