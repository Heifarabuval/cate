import { describe, expect, it } from 'vitest'
import { formatOutput } from './format'

describe('panelList', () => {
  it('marks the focused panel with * and the calling panel with >', () => {
    const rows = [
      { panelId: 'aaaaaaaa-1', type: 'terminal', title: 'zsh', focused: true, caller: false },
      { panelId: 'bbbbbbbb-2', type: 'terminal', title: 'me', focused: false, caller: true },
      { panelId: 'cccccccc-3', type: 'browser', title: 'x', url: 'https://example.com', focused: false, caller: false }
    ]
    const lines = formatOutput('panelList', rows).split('\n')
    expect(lines[1]).toMatch(/^\*\s+aaaaaaaa/)
    expect(lines[2]).toMatch(/^>\s+bbbbbbbb/)
    expect(lines[3]).toMatch(/^\s+cccccccc/)
  })

  it('prints a sent prompt: its id alone when typed at once, id first and the wait when queued', () => {
    expect(formatOutput('promptId', { promptId: 'p1', state: 'sending', ahead: 0 })).toBe('p1')
    expect(formatOutput('promptId', { promptId: 'p2', state: 'queued', ahead: 3 })).toBe('p2 queued (3 ahead)')
    expect(formatOutput('promptId', { promptId: 'p3' })).toBe('p3')
  })
})
