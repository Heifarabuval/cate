import { describe, expect, it } from 'vitest'
import { MAX_REF_LENGTH, OBSERVATION_KINDS, cleanInput, countObservations, parseObservation, type Observation } from './observation'

const PANEL = '3f2a9c1e-7b4d-4e0a-9d51-0a1b2c3d4e5f'
const NONE: readonly string[] = []

describe('cleanInput', () => {
  it('keeps a panel fact as it is', () => {
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: PANEL }, NONE))
      .toEqual({ kind: 'panel.created', panelType: 'browser', ref: PANEL })
    expect(cleanInput({ kind: 'panel.closed', panelType: 'terminal', ref: PANEL }, NONE))
      .toEqual({ kind: 'panel.closed', panelType: 'terminal', ref: PANEL })
    expect(cleanInput({ kind: 'panel.linked', panelType: 'browser', ref: PANEL }, NONE))
      .toEqual({ kind: 'panel.linked', panelType: 'browser', ref: PANEL })
  })

  it('strips a navigation to the URL without parameters', () => {
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/a/b?token=abc#x' }, NONE))
      .toEqual({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/a/b' })
  })

  it('masks an address, a base64 token and a long word in the path of a navigation', () => {
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/u/jane.doe@example.com/t/dG9rZW4=/s/abcdefghijklmnop' }, NONE))
      .toEqual({ kind: 'navigate', panelType: 'browser', ref: 'https://example.com/u/*/t/*/s/*' })
  })

  it('drops a navigation to an excluded domain, subdomains included, even with credentials in the URL', () => {
    const list = ['exemple.fr']
    for (const ref of ['https://exemple.fr/compte', 'https://www.exemple.fr/a?b=1', 'https://me:pw@app.exemple.fr/']) {
      expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref }, list), ref).toBeNull()
    }
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: 'https://banque-exemple.fr/' }, list)).not.toBeNull()
  })

  it('drops a navigation to a page that is not http or https', () => {
    for (const ref of ['file:///Users/me/a.html', 'cate://newtab', 'about:blank', 'javascript:1']) {
      expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref }, NONE), ref).toBeNull()
    }
  })

  it('refuses a kind it does not know, the keyboard and the terminal line included', () => {
    for (const kind of ['click', 'field', 'terminal.command', 'keypress', 'key', 'input', 'clipboard', 'panel.title', '']) {
      expect(cleanInput({ kind, panelType: 'browser', ref: PANEL }, NONE), kind).toBeNull()
    }
  })

  it('refuses a panel type it does not know', () => {
    expect(cleanInput({ kind: 'panel.created', panelType: 'toaster', ref: PANEL }, NONE)).toBeNull()
    expect(cleanInput({ kind: 'panel.created', panelType: 3, ref: PANEL }, NONE)).toBeNull()
  })

  it('refuses a field in excess or a missing one', () => {
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: PANEL, title: 'Secret plan' }, NONE)).toBeNull()
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: PANEL, value: 'ABC-123' }, NONE)).toBeNull()
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser' }, NONE)).toBeNull()
    expect(cleanInput({ panelType: 'browser', ref: PANEL }, NONE)).toBeNull()
  })

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'panel.created', 7, [], [{ kind: 'panel.created' }]]) {
      expect(cleanInput(value, NONE)).toBeNull()
    }
  })

  it('refuses a panel reference that is not an identifier', () => {
    for (const ref of ['', 'Mon titre secret', 'a\nb', 'id with space', 'a'.repeat(129), '../etc/passwd', 'https://example.com/a']) {
      expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref }, NONE), ref).toBeNull()
    }
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: 42 }, NONE)).toBeNull()
  })

  it('refuses a reference that is too long once cleaned', () => {
    const ref = `https://example.com/${'a/'.repeat(MAX_REF_LENGTH)}`
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref }, NONE)).toBeNull()
  })

  it('takes a panel reference of 1 to 128 characters', () => {
    for (const length of [1, 2, 127, 128]) expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: 'a'.repeat(length) }, NONE), String(length)).not.toBeNull()
    expect(cleanInput({ kind: 'panel.created', panelType: 'browser', ref: 'a'.repeat(129) }, NONE)).toBeNull()
  })

  it('takes a cleaned address of 512 characters and refuses one of 513', () => {
    const at512 = `https://example.com/${'a/'.repeat(246)}`
    expect(MAX_REF_LENGTH).toBe(512)
    expect(at512).toHaveLength(512)
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: at512 }, NONE)?.ref).toBe(at512)
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: `${at512}b` }, NONE)).toBeNull()
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: `https://example.com/${'a/'.repeat(245)}b` }, NONE)).not.toBeNull()
  })

  it('reads an address of 8192 characters, and refuses one of 8193 without reading it', () => {
    const head = 'https://example.com/a?'
    const address = (length: number) => head + 'x'.repeat(length - head.length)
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: address(8192) }, NONE)?.ref).toBe('https://example.com/a')
    expect(cleanInput({ kind: 'navigate', panelType: 'browser', ref: address(8193) }, NONE)).toBeNull()
  })

  it('lists the kinds of the socle, and no other', () => {
    expect(OBSERVATION_KINDS).toEqual(['panel.created', 'panel.closed', 'panel.linked', 'navigate'])
  })
})

describe('parseObservation', () => {
  const line = { ts: '2026-11-20T10:00:00.000Z', kind: 'panel.created', panelType: 'browser', ref: PANEL }

  it('reads a line the journal wrote', () => {
    expect(parseObservation(line)).toEqual(line)
    expect(parseObservation({ ...line, ts: '2026-11-20T10:00:00Z' })).not.toBeNull()
  })

  it('refuses a line with a field in excess, a missing one or a bad time', () => {
    expect(parseObservation({ ...line, extra: 1 })).toBeNull()
    expect(parseObservation({ kind: line.kind, panelType: line.panelType, ref: line.ref })).toBeNull()
    expect(parseObservation({ ...line, ts: 'yesterday' })).toBeNull()
    expect(parseObservation({ ...line, ts: '2026-13-45T10:00:00.000Z' })).toBeNull()
    expect(parseObservation({ ...line, ts: 1763632800000 })).toBeNull()
  })

  it('refuses a kind or a panel type it does not know', () => {
    expect(parseObservation({ ...line, kind: 'click' })).toBeNull()
    expect(parseObservation({ ...line, panelType: 'toaster' })).toBeNull()
  })

  it('takes a time with 0 to 3 fractional digits and nothing around it', () => {
    for (const ts of ['2026-11-20T10:00:00Z', '2026-11-20T10:00:00.1Z', '2026-11-20T10:00:00.12Z', '2026-11-20T10:00:00.123Z']) {
      expect(parseObservation({ ...line, ts }), ts).not.toBeNull()
    }
    for (const ts of [
      '2026-11-20T10:00:00.Z', '2026-11-20T10:00:00.1234Z', ' 2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z ',
      'x2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Zx', '2026-11-20T10:00:00.000+01:00', '2026-11-20 10:00:00.000Z',
    ]) expect(parseObservation({ ...line, ts }), ts).toBeNull()
  })

  it('refuses a line with only two of the three fields, and one with the wrong three', () => {
    expect(parseObservation({ ts: line.ts, kind: line.kind, panelType: line.panelType })).toBeNull()
    expect(parseObservation({ ts: line.ts, kind: line.kind, ref: line.ref, title: 'x' })).toBeNull()
    expect(parseObservation({ ts: line.ts, kind: line.kind, panelType: line.panelType, ref: line.ref, extra: 1 })).toBeNull()
  })

  it('refuses a navigation that was edited to carry a parameter or a credential', () => {
    const nav = { ...line, kind: 'navigate', ref: 'https://example.com/a' }
    expect(parseObservation(nav)).toEqual(nav)
    expect(parseObservation({ ...nav, ref: 'https://example.com/a?token=abc' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://example.com/a#x' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://me:pw@example.com/a' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://example.com/u/jane.doe@example.com' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://example.com/t/dG9rZW4=' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://example.com/s/abcdefghijklmnop' })).toBeNull()
    expect(parseObservation({ ...nav, ref: 'https://example.com/u/*/t/*' })).not.toBeNull()
  })

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'x', 3, []]) expect(parseObservation(value)).toBeNull()
  })
})

describe('countObservations', () => {
  const line = (kind: Observation['kind'], panelType: Observation['panelType'], ref: string): Observation => ({ ts: '2026-11-20T10:00:00.000Z', kind, panelType, ref })

  it('counts the lines of each kind on each panel type, and keeps no ref', () => {
    const counts = countObservations([
      line('navigate', 'browser', 'https://example.com/a'),
      line('panel.created', 'browser', PANEL),
      line('navigate', 'browser', 'https://example.com/b'),
      line('panel.created', 'terminal', 't1'),
      line('navigate', 'browser', 'https://example.com/a'),
    ])
    expect(counts).toEqual([
      { kind: 'navigate', panelType: 'browser', count: 3 },
      { kind: 'panel.created', panelType: 'browser', count: 1 },
      { kind: 'panel.created', panelType: 'terminal', count: 1 },
    ])
    expect(JSON.stringify(counts)).not.toMatch(/example\.com|t1|3f2a9c1e/)
  })

  it('orders by kind then by panel type, whatever the order of the lines', () => {
    const counts = countObservations([
      line('panel.linked', 'terminal', 'a'),
      line('panel.closed', 'terminal', 'b'),
      line('panel.closed', 'browser', 'c'),
      line('navigate', 'browser', 'https://example.com/'),
    ])
    expect(counts.map((one) => `${one.kind} ${one.panelType}`)).toEqual([
      'navigate browser',
      'panel.closed browser',
      'panel.closed terminal',
      'panel.linked terminal',
    ])
  })

  it('is empty for no line', () => {
    expect(countObservations([])).toEqual([])
  })
})
