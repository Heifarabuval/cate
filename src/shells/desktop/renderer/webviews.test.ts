import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../contract'
import { prepareWebviewPartitions } from './webviews'

const RUNTIME = 'abcdefghijklmnop'

const fake = vi.hoisted(() => ({ connect: null as null | ((connection: unknown) => () => void) }))
vi.mock('@client/connections', () => ({
  eachConnection: (_connections: unknown, each: (connection: unknown) => () => void) => {
    fake.connect = each
    return () => {}
  }
}))

const connection = (workspaceId = 'w1') => ({
  workspaceId,
  state: { kind: 'connected' },
  reachesClientNetwork: false,
  runtime: { workspace: { info: async () => ({ runtimeId: RUNTIME }) } },
  subscribe: () => () => {}
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup() {
  const appPartitionFor = vi.fn(async ({ runtimeId, appId }: { runtimeId: string; appId: string }) => `app-${runtimeId}-${appId}`)
  const api = { web: { partitionFor: vi.fn(async () => `persist:ws-${RUNTIME}`), release: vi.fn(async () => {}), appPartitionFor } } as unknown as DesktopApi
  const partitions = prepareWebviewPartitions(api, {} as never)
  return { partitions, appPartitionFor }
}

afterEach(() => { fake.connect = null })

it('prepares a custom panel partition once the workspace partition is ready, not before', async () => {
  const { partitions, appPartitionFor } = setup()
  partitions.prepareApp('w1', 'notes')
  expect(appPartitionFor).not.toHaveBeenCalled()
  fake.connect!(connection())
  await flush()
  expect(appPartitionFor).toHaveBeenCalledWith({ runtimeId: RUNTIME, appId: 'notes', reachesClientNetwork: false })
  expect(partitions.appPartition('w1', 'notes')).toBe(`app-${RUNTIME}-notes`)
})

it('asks main once per panel, signals the change, and forgets a workspace that closed', async () => {
  const { partitions, appPartitionFor } = setup()
  const changed = vi.fn()
  partitions.subscribe(changed)
  const close = fake.connect!(connection())
  await flush()
  partitions.prepareApp('w1', 'notes')
  partitions.prepareApp('w1', 'notes')
  await flush()
  expect(appPartitionFor).toHaveBeenCalledTimes(1)
  expect(changed).toHaveBeenCalled()
  close()
  expect(partitions.appPartition('w1', 'notes')).toBeNull()
})

it('has no partition for a panel nobody asked for', async () => {
  const { partitions } = setup()
  fake.connect!(connection())
  await flush()
  expect(partitions.appPartition('w1', 'notes')).toBeNull()
})
