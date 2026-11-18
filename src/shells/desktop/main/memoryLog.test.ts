import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, webContents: {} }))

const { describeMainMemory } = await import('./memoryLog')

const MB = 1024 * 1024

describe('describeMainMemory', () => {
  it('reports the footprint, the JS side and what holds native memory', () => {
    const line = describeMainMemory({
      footprintKB: 10 * 1024 * 1024,
      usage: { rss: 300 * MB, heapTotal: 2300 * MB, heapUsed: 2200 * MB, external: 40 * MB, arrayBuffers: 12 * MB },
      contents: [
        { type: 'window', debugged: false },
        { type: 'webview', debugged: true },
        { type: 'webview', debugged: true },
        { type: 'webview', debugged: false },
      ],
      resources: ['PipeWrap', 'PipeWrap', 'TCPSocketWrap', 'Timeout', 'PipeWrap'],
      processes: [
        { type: 'Browser', memoryKB: 300 * 1024 },
        { type: 'Tab', memoryKB: 512 * 1024 },
        { type: 'Tab', memoryKB: 512 * 1024 },
        { type: 'GPU', memoryKB: 100 * 1024 },
      ],
    })
    expect(line).toBe('footprint=10240MB rss=300MB heap=2200/2300MB external=40MB arrayBuffers=12MB'
      + ' webContents=window:1,webview:3 debuggers=2 sockets=pipe:3,tcp:1'
      + ' processes=4 tabsMB=1024')
  })

  it('says when the footprint is unknown', () => {
    const line = describeMainMemory({
      footprintKB: undefined,
      usage: { rss: MB, heapTotal: MB, heapUsed: MB, external: 0, arrayBuffers: 0 },
      contents: [],
      resources: [],
      processes: [],
    })
    expect(line).toMatch(/^footprint=\? /)
    expect(line).toContain('webContents=- debuggers=0 sockets=pipe:0,tcp:0 processes=0 tabsMB=0')
  })
})
