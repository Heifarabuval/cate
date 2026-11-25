// Reads the machine's memory on macOS: pressure from `memory_pressure`, and
// the resident memory of each agent (a `claude` process and its children)
// from `ps`. Parsing is pure and tested; only `readMemory` touches the system.

import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

export interface MemoryReading {
  availableMb: number
  agentMb: number[]
}

/** "System-wide memory free percentage: 62%" -> 62, else null. */
export function parseFreePercentage(output: string): number | null {
  const match = /memory free percentage:\s*(\d+)%/i.exec(output)
  return match ? Number(match[1]) : null
}

/** MB per agent from `ps -axo pid=,ppid=,rss=,comm=`: each `claude` process
 *  with its descendants. A `claude` under another `claude` counts in the parent. */
export function parseAgentMb(output: string): number[] {
  const procs = new Map<number, { ppid: number; kb: number; name: string }>()
  const children = new Map<number, number[]>()
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const [pid, ppid, kb] = [Number(m[1]), Number(m[2]), Number(m[3])]
    procs.set(pid, { ppid, kb, name: path.basename(m[4]) })
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const tree = (pid: number): number =>
    (procs.get(pid)?.kb ?? 0) + (children.get(pid) ?? []).reduce((sum, c) => sum + tree(c), 0)
  const isRoot = (pid: number) =>
    procs.get(pid)?.name === 'claude' && procs.get(procs.get(pid)!.ppid)?.name !== 'claude'
  return [...procs.keys()].filter(isRoot).map((pid) => tree(pid) / 1024)
}

const run = promisify(execFile)

export async function readMemory(): Promise<MemoryReading> {
  const [pressure, ps] = await Promise.all([
    run('memory_pressure', ['-Q']),
    run('ps', ['-axo', 'pid=,ppid=,rss=,comm=']),
  ])
  const free = parseFreePercentage(pressure.stdout)
  // Unknown pressure counts as no room: better a queue than swapping.
  const availableMb = free === null ? 0 : (os.totalmem() / 1024 / 1024) * (free / 100)
  return { availableMb, agentMb: parseAgentMb(ps.stdout) }
}
