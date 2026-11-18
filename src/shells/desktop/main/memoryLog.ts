// Main-process memory in main.log every 5 minutes (issue #15). The footprint
// counts swapped memory (RSS does not); next to the JS heap, external memory
// and ArrayBuffers, it tells a JS leak from a native one. The webContents,
// attached debuggers (page drivers), sockets and child processes say what was
// open when a jump happened.

import { app, webContents } from 'electron'
import { createLogger } from '@kernel/log/contract'

const log = createLogger('memory')
const INTERVAL_MS = 5 * 60_000
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)

export interface MainMemorySample {
  /** Private footprint in KB (macOS: phys_footprint, swap included). */
  footprintKB: number | undefined
  usage: NodeJS.MemoryUsage
  contents: { type: string; debugged: boolean }[]
  /** `process.getActiveResourcesInfo()`. */
  resources: string[]
  processes: { type: string; memoryKB: number }[]
}

export function describeMainMemory(sample: MainMemorySample): string {
  const { usage } = sample
  const types = new Map<string, number>()
  for (const { type } of sample.contents) types.set(type, (types.get(type) ?? 0) + 1)
  const count = (name: string) => sample.resources.filter((r) => r === name).length
  const tabsKB = sample.processes.filter((p) => p.type === 'Tab').reduce((sum, p) => sum + p.memoryKB, 0)
  return [
    `footprint=${sample.footprintKB === undefined ? '?' : `${Math.round(sample.footprintKB / 1024)}MB`}`,
    `rss=${mb(usage.rss)}MB`,
    `heap=${mb(usage.heapUsed)}/${mb(usage.heapTotal)}MB`,
    `external=${mb(usage.external)}MB`,
    `arrayBuffers=${mb(usage.arrayBuffers)}MB`,
    `webContents=${[...types].map(([type, n]) => `${type}:${n}`).join(',') || '-'}`,
    `debuggers=${sample.contents.filter((c) => c.debugged).length}`,
    `sockets=pipe:${count('PipeWrap')},tcp:${count('TCPSocketWrap')}`,
    `processes=${sample.processes.length}`,
    `tabsMB=${Math.round(tabsKB / 1024)}`,
  ].join(' ')
}

async function sample(): Promise<MainMemorySample> {
  const info = await process.getProcessMemoryInfo().catch(() => undefined)
  return {
    footprintKB: info?.private,
    usage: process.memoryUsage(),
    contents: webContents.getAllWebContents().filter((c) => !c.isDestroyed())
      .map((c) => ({ type: c.getType(), debugged: c.debugger.isAttached() })),
    resources: process.getActiveResourcesInfo(),
    processes: app.getAppMetrics().map((m) => ({ type: m.type, memoryKB: m.memory.workingSetSize })),
  }
}

export function startMemoryLog(): void {
  const write = () => { void sample().then((s) => log.info(describeMainMemory(s)), (error) => log.warn('sample failed: %O', error)) }
  write()
  setInterval(write, INTERVAL_MS).unref()
}
