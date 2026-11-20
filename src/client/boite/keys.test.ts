import { describe, expect, it } from 'vitest'
import { keyOutcome, type KeyRow } from './keys'

const draft: KeyRow['action'] = { type: 'draft', hash: 'h1', inFlight: false }
const rows = (...keys: string[]): KeyRow[] => keys.map((key) => ({ key, action: draft }))
const base = { selectedKey: 'a', shown: {} as Record<string, string> }

describe('keyOutcome', () => {
  it('moves the selection with next (J, arrow down) and previous (K) and stops at the ends', () => {
    const list = rows('a', 'b', 'c')
    expect(keyOutcome('next', { rows: list, ...base })).toEqual({ type: 'select', key: 'b' })
    expect(keyOutcome('skip', { rows: list, ...base })).toEqual({ type: 'select', key: 'b' })
    expect(keyOutcome('previous', { rows: list, selectedKey: 'c', shown: {} })).toEqual({ type: 'select', key: 'b' })
    expect(keyOutcome('previous', { rows: list, ...base })).toEqual({ type: 'select', key: 'a' })
    expect(keyOutcome('next', { rows: list, selectedKey: 'c', shown: {} })).toEqual({ type: 'select', key: 'c' })
  })

  it('selects the first line when nothing, or a line that left, is selected', () => {
    expect(keyOutcome('next', { rows: rows('a', 'b'), selectedKey: null, shown: {} })).toEqual({ type: 'select', key: 'a' })
    expect(keyOutcome('next', { rows: rows('a', 'b'), selectedKey: 'gone', shown: {} })).toEqual({ type: 'select', key: 'a' })
    expect(keyOutcome('next', { rows: [], selectedKey: null, shown: {} })).toBeNull()
  })

  it('Enter shows the selected draft, and nothing on a line with no text', () => {
    expect(keyOutcome('open', { rows: rows('a'), ...base })).toEqual({ type: 'show', key: 'a' })
    expect(keyOutcome('open', { rows: [{ key: 'a', action: { type: 'link' } }], ...base })).toBeNull()
  })

  it('Cmd+Enter sends only a draft whose text is shown, else it shows the text', () => {
    expect(keyOutcome('send', { rows: rows('a'), selectedKey: 'a', shown: { a: 'h1' } })).toEqual({ type: 'send', key: 'a' })
    expect(keyOutcome('send', { rows: rows('a'), ...base })).toEqual({ type: 'show', key: 'a' })
    // The text changed under the display: not shown any more.
    expect(keyOutcome('send', { rows: rows('a'), selectedKey: 'a', shown: { a: 'old' } })).toEqual({ type: 'show', key: 'a' })
  })

  it('never sends a draft already in flight', () => {
    const inFlight: KeyRow[] = [{ key: 'a', action: { type: 'draft', hash: 'h1', inFlight: true } }]
    expect(keyOutcome('send', { rows: inFlight, selectedKey: 'a', shown: { a: 'h1' } })).toBeNull()
  })

  it('targets the selected key when the list reorders, never a position', () => {
    // 'a' was first; a new line came above it: Cmd+Enter still sends 'a'.
    expect(keyOutcome('send', { rows: rows('z', 'a'), selectedKey: 'a', shown: { a: 'h1' } })).toEqual({ type: 'send', key: 'a' })
    expect(keyOutcome('next', { rows: rows('z', 'a', 'b'), ...base })).toEqual({ type: 'select', key: 'b' })
  })

  it('acts on nothing when the selected line left', () => {
    expect(keyOutcome('send', { rows: rows('z'), selectedKey: 'a', shown: { a: 'h1' } })).toBeNull()
    expect(keyOutcome('open', { rows: rows('z'), selectedKey: 'a', shown: {} })).toBeNull()
  })
})
