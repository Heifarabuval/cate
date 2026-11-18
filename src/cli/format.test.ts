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
})
