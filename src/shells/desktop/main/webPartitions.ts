// Browser partitions and their loopback web proxies (architecture 12.3). One
// partition per workspace runtime (`persist:ws-<runtimeId>`, shared by its
// browser panels). Connections allowed to reach this machine's network use
// Chromium's native networking; others use the workspace proxy, including
// loopback. The proxy reaches loopback
// ports through a renderer that holds the workspace connection: main asks it
// for a pipe per connection (`dialLoopback` there is the transport's choice).

import type { Session } from 'electron'
import type { ByteDuplex } from '@kernel/rpc/contract'
import { createLogger } from '@kernel/log/contract'
import { isRuntimeId } from '@runtime/data/contract'
import { agentPartition, workspacePartition } from '@services/browser/contract'
import { createProxyCredentials, startLoopbackProxy, type LoopbackProxy, type ProxyCredentials } from './loopbackProxy'
import { authenticatedBrowserProxy, browserProxyConfig } from './browserProxy'

const log = createLogger('web')

const APP_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A custom panel's partition (spec 008): its own, never persisted (no
 *  `persist:`), so no cookie, storage or sign-in survives it or reaches
 *  another panel or the user's browsing. The runtime is part of the name: the
 *  partition routes through that runtime's loopback proxy. */
export const isAppPartition = (partition: string): boolean => partition.startsWith('app-')

export const appPartition = (runtimeId: string, appId: string): string => `app-${runtimeId}-${appId}`

export interface LoopbackDialer {
  readonly id: number
  isDestroyed(): boolean
  /** Asks this renderer for a pipe to `port` on the runtime's machine. */
  dial(runtimeId: string, port: number): Promise<ByteDuplex>
}

export interface WebPartitionsDeps {
  session(partition: string): Pick<Session, 'setProxy' | 'closeAllConnections' | 'clearStorageData'>
  /** The client's `browserProxyUrl`. */
  upstream(): string | undefined
  /** Seam for tests. */
  startProxy?: typeof startLoopbackProxy
  /** Runs once per partition before its first webview mounts (shared sign-ins). */
  beforeFirstMount?(partition: string): Promise<void>
}

export interface WebPartitions {
  readonly credentials: ProxyCredentials
  /** Prepares the workspace's partition and registers `dialer` for its
   *  loopback requests; the partition name. `reachesClientNetwork`: the
   *  dialer's connection is on this machine's network (12.3). */
  partitionFor(runtimeId: string, dialer: LoopbackDialer, reachesClientNetwork: boolean): Promise<string>
  /** Prepares the partition of custom panel `appId` of a runtime, behind the
   *  same loopback proxy as the workspace's; the partition name. */
  appPartitionFor(runtimeId: string, appId: string, dialer: LoopbackDialer, reachesClientNetwork: boolean): Promise<string>
  release(runtimeId: string, dialerId: number): void
  /** Drops every registration of a renderer that went away. */
  releaseDialer(dialerId: number): void
  /** True for a workspace partition whose network policy is in place. */
  isPrepared(partition: string): boolean
  /** True for a partition made by `agentPartitionFor` and not released. */
  isAgentPartition(partition: string): boolean
  /** Prepares the in-memory partition of an agent-driven panel, with the
   *  workspace's network policy and no shared sign-ins; its name. */
  agentPartitionFor(runtimeId: string, panelId: string): Promise<string>
  /** Forgets an agent partition and clears what it holds; other names are ignored. */
  releaseAgentPartition(partition: string): Promise<void>
  /** Reapply changed client proxy settings to every prepared partition. */
  refresh(): Promise<void>
  /** Answers Chromium's proxy auth challenge for our proxies. */
  credentialsFor(host: string, port: number): ProxyCredentials | null
  close(): Promise<void>
}

export function createWebPartitions(deps: WebPartitionsDeps): WebPartitions {
  const credentials = createProxyCredentials()
  const startProxy = deps.startProxy ?? startLoopbackProxy
  const proxies = new Map<string, Promise<LoopbackProxy>>()
  const ports = new Set<number>()
  const prepared = new Set<string>()
  const dialers = new Map<string, LoopbackDialer[]>()
  // False once any connection to the runtime said it does not reach this
  // machine's network: the private ranges stay refused for that runtime.
  const reaches = new Map<string, boolean>()
  const configuring = new Map<string, Promise<void>>()
  const configured = new Map<string, string>()
  // Agent partitions and the runtime each belongs to.
  const agents = new Map<string, string>()
  // Custom panel partitions and the runtime each belongs to (spec 008).
  const apps = new Map<string, string>()

  const dialLoopback = async (runtimeId: string, port: number): Promise<ByteDuplex> => {
    const live = (dialers.get(runtimeId) ?? []).filter((d) => !d.isDestroyed())
    dialers.set(runtimeId, live)
    if (live.length === 0) throw new Error(`no window is connected to runtime ${runtimeId}`)
    let lastError: unknown
    for (const dialer of live) {
      try { return await dialer.dial(runtimeId, port) } catch (error) { lastError = error }
    }
    throw lastError
  }

  const ensureProxy = (runtimeId: string): Promise<LoopbackProxy> => {
    let proxy = proxies.get(runtimeId)
    if (!proxy) {
      proxy = (async () => {
        const started = await startProxy({
          credentials,
          upstream: deps.upstream,
          reachesClientNetwork: () => reaches.get(runtimeId) === true,
          dialLoopback: (port) => dialLoopback(runtimeId, port),
        })
        ports.add(started.port)
        return started
      })()
      proxies.set(runtimeId, proxy)
      proxy.catch(() => proxies.delete(runtimeId))
    }
    return proxy
  }

  const prepare = (runtimeId: string, agent?: string): Promise<void> => {
    // Serialize settings changes and stricter connection policies. A later
    // caller must never inherit an in-flight, less restrictive configuration.
    const partition = agent ?? workspacePartition(runtimeId)
    const task = (configuring.get(partition) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const session = deps.session(partition)
      for (;;) {
        const native = reaches.get(runtimeId) === true
        const upstream = deps.upstream()
        const key = JSON.stringify([native, upstream ?? ''])
        if (configured.get(partition) === key && prepared.has(partition)) return
        prepared.delete(partition)
        const proxy = native ? null : await ensureProxy(runtimeId)
        await session.setProxy(proxy ? {
          mode: 'fixed_servers',
          proxyRules: `http://127.0.0.1:${proxy.port}`,
          proxyBypassRules: '<-loopback>',
        } : browserProxyConfig(upstream))
        // Do not reuse direct sockets after a policy downgrade, or sockets to
        // a previous upstream proxy after a settings change.
        if (configured.has(partition)) await session.closeAllConnections()
        configured.set(partition, key)
        // Policy or settings may have changed during setProxy. Finish applying
        // them before allowing even the first caller to mount a webview.
        if (native !== (reaches.get(runtimeId) === true) || upstream !== deps.upstream()) continue
        // An agent or custom panel partition never receives the shared sign-ins.
        if (!agent) await deps.beforeFirstMount?.(partition)
        prepared.add(partition)
        log.info('partition %s uses %s networking', partition, proxy ? 'protected workspace proxy' : 'Chromium')
        return
      }
    })
    configuring.set(partition, task)
    return task
  }

  // A workspace partition's policy change reaches the custom panels of that runtime.
  const prepareApps = (runtimeId: string): Promise<unknown> =>
    Promise.all([...apps].filter(([, id]) => id === runtimeId).map(([partition]) => prepare(runtimeId, partition)))

  return {
    credentials,
    async partitionFor(runtimeId, dialer, reachesClientNetwork) {
      if (!isRuntimeId(runtimeId)) throw new Error('invalid runtime id')
      reaches.set(runtimeId, (reaches.get(runtimeId) ?? true) && reachesClientNetwork)
      const list = dialers.get(runtimeId) ?? []
      if (!list.some((d) => d.id === dialer.id)) list.push(dialer)
      dialers.set(runtimeId, list)
      await prepare(runtimeId)
      await prepareApps(runtimeId)
      return workspacePartition(runtimeId)
    },
    async agentPartitionFor(runtimeId, panelId) {
      if (!isRuntimeId(runtimeId)) throw new Error('invalid runtime id')
      if (!reaches.has(runtimeId)) throw new Error('no connection prepared this runtime')
      const partition = agentPartition(workspacePartition(runtimeId), panelId)
      agents.set(partition, runtimeId)
      await prepare(runtimeId, partition)
      return partition
    },
    async releaseAgentPartition(partition) {
      if (!agents.delete(partition)) return
      await configuring.get(partition)?.catch(() => {})
      prepared.delete(partition)
      configured.delete(partition)
      configuring.delete(partition)
      await deps.session(partition).clearStorageData()
    },
    async appPartitionFor(runtimeId, appId, dialer, reachesClientNetwork) {
      if (!isRuntimeId(runtimeId)) throw new Error('invalid runtime id')
      if (!APP_ID.test(appId)) throw new Error('invalid panel id')
      reaches.set(runtimeId, (reaches.get(runtimeId) ?? true) && reachesClientNetwork)
      const list = dialers.get(runtimeId) ?? []
      if (!list.some((d) => d.id === dialer.id)) list.push(dialer)
      dialers.set(runtimeId, list)
      const partition = appPartition(runtimeId, appId)
      apps.set(partition, runtimeId)
      await prepare(runtimeId, partition)
      return partition
    },
    release(runtimeId, dialerId) {
      const list = dialers.get(runtimeId)
      if (list) dialers.set(runtimeId, list.filter((d) => d.id !== dialerId))
    },
    releaseDialer(dialerId) {
      for (const [runtimeId, list] of dialers) dialers.set(runtimeId, list.filter((d) => d.id !== dialerId))
    },
    isPrepared: (partition) => prepared.has(partition),
    isAgentPartition: (partition) => agents.has(partition),
    refresh: async () => {
      await Promise.all([
        ...[...reaches.keys()].map((runtimeId) => prepare(runtimeId)),
        ...[...agents, ...apps].map(([partition, runtimeId]) => prepare(runtimeId, partition)),
      ])
    },
    credentialsFor(host, port) {
      if (host === '127.0.0.1' && ports.has(port)) return credentials
      const upstream = authenticatedBrowserProxy(deps.upstream())
      return upstream?.host === host && upstream.port === port ? upstream.credentials : null
    },
    async close() {
      await Promise.allSettled(configuring.values())
      const all = [...proxies.values()]
      proxies.clear()
      await Promise.allSettled(all.map(async (p) => (await p).close()))
      // A failed update installer can leave this client running. Refresh must
      // then recreate its proxies instead of reusing their closed ports.
      prepared.clear()
      ports.clear()
    },
  }
}
