import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { defineCapability, framePortOver, method } from '@kernel/rpc/contract'
import { RpcClient, createCapabilityProxy } from '@kernel/rpc/client'
import { RpcServer } from '@kernel/rpc/runtime'
import { createLifecycleBus } from '@kernel/lifecycle/contract'
import { acquireRuntimeSocket } from '@runtime/data/runtime'
import { dialLocal } from './node'
import { serveLocal } from './runtime'

const pingCap = defineCapability('ping', { methods: { ping: method<void, string>() } })

const newClient = () => new RpcClient({ version: 'test', identity: { client: { clientId: 'c1', device: { name: 'test', publicKey: 'fp' }, features: [] } } })

/** Resolves once `server` has `n` open connections. */
const connections = (server: net.Server, n: number) => vi.waitFor(() => new Promise<void>((resolve, reject) => {
  server.getConnections((_, count) => (count === n ? resolve() : reject(new Error(`${count} connections`))))
}))

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-t-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

it.skipIf(process.platform === 'win32')('holds connections that arrive before open, then serves them', async () => {
  const endpoint = path.join(dir, 's.sock')
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  const rpc = new RpcServer({ version: 'test', lifecycle: createLifecycleBus() })
  const listener = serveLocal({ server, takeEarly: () => [] }, rpc)

  const client = new RpcClient({ version: 'test', identity: { client: { clientId: 'c1', device: { name: 'test', publicKey: 'fp' }, features: [] } } })
  const ready = client.attach(framePortOver(await dialLocal(endpoint), 'stream'))
  await new Promise((r) => setTimeout(r, 50))
  rpc.register(pingCap, { ping: () => 'pong' })
  listener.open()
  await ready
  expect(await createCapabilityProxy(client, pingCap).ping()).toBe('pong')

  client.close()
  await listener.close()
  await expect(dialLocal(endpoint, { timeoutMs: 500 })).rejects.toThrow()
})

// A daemon awaits between binding the socket and serving it; a client that
// retries meanwhile (a restart) must be served, and must not keep the
// listener from closing.
it.skipIf(process.platform === 'win32')('serves a connection that arrives between the bind and serveLocal', async () => {
  const lock = await acquireRuntimeSocket(dir, 'abcdefghijklmnop')
  if (lock.kind !== 'acquired') throw new Error(lock.kind)
  const client = new RpcClient({ version: 'test', identity: { client: { clientId: 'c1', device: { name: 'test', publicKey: 'fp' }, features: [] } } })
  const ready = client.attach(framePortOver(await dialLocal(lock.endpoint), 'stream'))
  // Accepted before anyone serves the socket.
  await vi.waitFor(() => new Promise<void>((resolve, reject) => lock.server.getConnections((_, n) => (n === 1 ? resolve() : reject(new Error(`${n} connections`))))))
  const rpc = new RpcServer({ version: 'test', lifecycle: createLifecycleBus() })
  rpc.register(pingCap, { ping: () => 'pong' })
  const listener = serveLocal(lock, rpc)
  listener.open()
  await ready
  expect(await createCapabilityProxy(client, pingCap).ping()).toBe('pong')
  await listener.close()
  client.close()
})

it.skipIf(process.platform === 'win32')('drops an early connection its client closed before the socket is served', async () => {
  const lock = await acquireRuntimeSocket(dir, 'abcdefghijklmnop')
  if (lock.kind !== 'acquired') throw new Error(lock.kind)
  const socket = net.connect(lock.endpoint)
  await connections(lock.server, 1)
  socket.destroy()
  await connections(lock.server, 0)
  expect(lock.takeEarly()).toEqual([])
  lock.server.close()
})

it.skipIf(process.platform === 'win32')('serves every connection that arrived before serveLocal', async () => {
  const lock = await acquireRuntimeSocket(dir, 'abcdefghijklmnop')
  if (lock.kind !== 'acquired') throw new Error(lock.kind)
  const clients = [newClient(), newClient()]
  const ports = await Promise.all(clients.map(() => dialLocal(lock.endpoint)))
  const ready = clients.map((client, i) => client.attach(framePortOver(ports[i], 'stream')))
  await connections(lock.server, 2)
  const rpc = new RpcServer({ version: 'test', lifecycle: createLifecycleBus() })
  rpc.register(pingCap, { ping: () => 'pong' })
  const listener = serveLocal(lock, rpc)
  listener.open()
  await Promise.all(ready)
  for (const client of clients) expect(await createCapabilityProxy(client, pingCap).ping()).toBe('pong')
  await listener.close()
  for (const client of clients) client.close()
})

// A start that fails after the bind closes the listener without opening it.
it.skipIf(process.platform === 'win32')('closes the held connections when the listener closes before it opens', async () => {
  const lock = await acquireRuntimeSocket(dir, 'abcdefghijklmnop')
  if (lock.kind !== 'acquired') throw new Error(lock.kind)
  const socket = net.connect(lock.endpoint)
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await connections(lock.server, 1)
  const listener = serveLocal(lock, new RpcServer({ version: 'test', lifecycle: createLifecycleBus() }))
  await listener.close()
  await closed
  await expect(dialLocal(lock.endpoint, { timeoutMs: 500 })).rejects.toThrow()
})

it('handles a client reset while the runtime is still starting', async () => {
  const server = net.createServer()
  const rpc = new RpcServer({ version: 'test', lifecycle: createLifecycleBus() })
  const listener = serveLocal({ server, takeEarly: () => [] }, rpc)
  const socket = new net.Socket()
  try {
    server.emit('connection', socket)
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    expect(() => socket.emit('error', reset)).not.toThrow()
    expect(socket.destroyed).toBe(true)
    // The disconnected client must not be served when startup finishes.
    listener.open()
  } finally {
    socket.destroy()
    await listener.close()
    rpc.close()
  }
})
