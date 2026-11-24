import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCapability, framePortOver, stream, type ByteDuplex } from '@kernel/rpc/contract'
import { RpcServer, type StreamSink } from '@kernel/rpc/runtime'
import { RpcClient, createCapabilityProxy } from '@kernel/rpc/client'
import { createLifecycleBus } from '@kernel/lifecycle/contract'
import { dialLocal, socketDuplex } from '@runtime/transports/node'
import { pipeDuplex, serveLoopbackRequests } from '../renderer/transports'
import { isPipeControl, type DesktopApi, type LoopbackRequest, type PipeMessage } from '../contract'
import { awaitPortPipe, bridgePipe, type MainPort } from './pipes'

/** Two connected ports in the shape of MessagePortMain. */
function portPair(): [MainPort & { closed: boolean }, MainPort & { closed: boolean }] {
  const make = () => Object.assign(new EventEmitter(), { closed: false, peer: null as any, start() {}, postMessage(data: unknown) {}, close() {} })
  const a = make()
  const b = make()
  for (const [self, other] of [[a, b], [b, a]] as const) {
    self.postMessage = (data: unknown) => { if (!self.closed) queueMicrotask(() => other.emit('message', { data })) }
    self.close = () => {
      if (self.closed) return
      self.closed = true
      queueMicrotask(() => other.emit('close'))
    }
  }
  return [a as any, b as any]
}

function fakeDuplex() {
  const data: ((b: Uint8Array) => void)[] = []
  const closes: ((r?: string) => void)[] = []
  const written: Uint8Array[] = []
  const duplex: ByteDuplex & { written: Uint8Array[]; push(b: Uint8Array): void; end(r?: string): void; closedWith?: string | null } = {
    written,
    write: (b) => { written.push(b) },
    onData: (l) => { data.push(l) },
    onClose: (l) => { closes.push(l) },
    close: (r) => { duplex.closedWith = r ?? null; for (const l of closes) l(r) },
    push: (b) => { for (const l of data) l(b) },
    end: (r) => { for (const l of closes) l(r) },
  }
  return duplex
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('main pipes', () => {
  it('bridges bytes both ways and closes the far end with a reason', async () => {
    const [mainEnd, rendererEnd] = portPair()
    const duplex = fakeDuplex()
    bridgePipe(duplex, mainEnd)
    const seen: unknown[] = []
    rendererEnd.on('message', ({ data }) => seen.push(data))
    duplex.push(new Uint8Array([1, 2]))
    rendererEnd.postMessage(new Uint8Array([3]))
    await tick()
    expect(seen).toEqual([new Uint8Array([1, 2])])
    expect(duplex.written).toEqual([new Uint8Array([3])])
    duplex.end('runtime went away')
    await tick()
    expect(seen.at(-1)).toEqual({ t: 'close', reason: 'runtime went away' })
  })

  it('closes the pipe when the renderer closes its end', async () => {
    const [mainEnd, rendererEnd] = portPair()
    const duplex = fakeDuplex()
    bridgePipe(duplex, mainEnd)
    rendererEnd.close()
    await tick()
    expect(duplex.closedWith).toBe('pipe closed')
  })

  it('awaits the renderer opening a loopback pipe, or its failure', async () => {
    const [mainEnd, rendererEnd] = portPair()
    const opened = awaitPortPipe(mainEnd)
    rendererEnd.postMessage(new Uint8Array([9]))
    rendererEnd.postMessage({ t: 'open' } satisfies PipeMessage)
    const duplex = await opened
    const got: Uint8Array[] = []
    duplex.onData((b) => got.push(b))
    expect(got).toEqual([new Uint8Array([9])])

    const [failing, other] = portPair()
    const refused = awaitPortPipe(failing)
    other.postMessage({ t: 'close', reason: 'nothing listens on 3000' } satisfies PipeMessage)
    await expect(refused).rejects.toThrow('nothing listens on 3000')
  })

  // Issue #15, hypothesis 1: the relay (socket 'data' -> port.postMessage)
  // keeps no queue of its own; what a renderer that stops draining can make
  // it carry is bounded by the byte stream credit window, end to end.
  // Not on Windows: the fork ships for macOS only, and there the relay is fed over a named pipe this test does not set up.
  it.skipIf(process.platform === 'win32')('relays at most the credit window to a renderer that stops acknowledging', async () => {
    const window = { high: 64 * 1024, low: 32 * 1024 }
    const chunk = 4096
    const cap = defineCapability('relayTest', {
      methods: {},
      streams: { pump: stream<void, never>({ bytes: true }) },
    })
    let produced = 0
    let stalled!: () => void
    const stall = new Promise<void>((resolve) => { stalled = resolve })
    const server = new RpcServer({ version: '1.0.0', lifecycle: createLifecycleBus(), window })
    server.register(cap, {
      pump: async (_p: void, sink: StreamSink<never>) => {
        // A terminal printing 64 MB: far more than the window.
        while (!sink.ended && produced < 64 * 1024 * 1024) {
          produced += chunk
          if (!sink.bytes(new Uint8Array(chunk))) {
            stalled()
            await sink.drain()
          }
        }
      },
    })
    const dir = mkdtempSync(join(tmpdir(), 'cate-relay-'))
    const endpoint = join(dir, 'runtime.sock')
    const listener = net.createServer((socket) => server.serve(framePortOver(socketDuplex(socket), 'stream')))
    await new Promise<void>((resolve) => listener.listen(endpoint, resolve))
    try {
      const [mainEnd, rendererEnd] = portPair()
      let relayed = 0
      const post = mainEnd.postMessage.bind(mainEnd)
      mainEnd.postMessage = (data: unknown) => {
        if (data instanceof Uint8Array) relayed += data.byteLength
        post(data)
      }
      bridgePipe(await dialLocal(endpoint), mainEnd)
      const renderer = rendererDuplex(rendererEnd)
      const client = new RpcClient({ version: '1.0.0', identity: { client: { clientId: 'c1', device: { name: 'mac', publicKey: 'fp' }, features: [] } } })
      await client.attach(framePortOver(renderer, 'stream'))
      const sub = createCapabilityProxy(client, cap).pump(undefined, { manualAck: true })
      let received = 0
      sub.onBytes((bytes) => { received += bytes.byteLength })
      await stall
      await new Promise((resolve) => setTimeout(resolve, 200))
      // Framing headers ride on top of the payload; the payload is capped.
      expect(received).toBeLessThanOrEqual(window.high + chunk)
      expect(relayed).toBeLessThan(window.high + chunk + 4096)
      expect(produced).toBeLessThanOrEqual(window.high + chunk)
      sub.cancel()
      client.close()
    } finally {
      listener.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** The renderer's end of a pipe: bytes from a port, as `pipeDuplex` reads them. */
function rendererDuplex(port: MainPort): ByteDuplex {
  const data: ((b: Uint8Array) => void)[] = []
  const closes: ((r?: string) => void)[] = []
  port.on('message', ({ data: message }) => {
    if (message instanceof Uint8Array) for (const l of data) l(message)
    else if (isPipeControl(message) && message.t === 'close') for (const l of closes) l(message.reason)
  })
  return {
    write: (bytes) => port.postMessage(bytes),
    onData: (l) => { data.push(l) },
    onClose: (l) => { closes.push(l) },
    close: () => port.close(),
  }
}

describe('renderer transports', () => {
  function fakeApi() {
    const listeners = new Map<string, (m: PipeMessage) => void>()
    let loopback: ((r: LoopbackRequest) => void) | null = null
    const pipes = {
      onMessage: vi.fn((pipe: string, l: (m: PipeMessage) => void) => { listeners.set(pipe, l); return () => listeners.delete(pipe) }),
      write: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
    }
    const api = {
      pipes,
      transports: {
        dialLocal: vi.fn(async () => 'p-local'),
        dialNetwork: vi.fn(async () => 'p-net'),
        dialLoopbackTcp: vi.fn(async () => 'p-tcp'),
        onLoopbackRequest: (l: (r: LoopbackRequest) => void) => { loopback = l; return () => { loopback = null } },
      },
    } as unknown as DesktopApi
    return { api, pipes, emit: (pipe: string, m: PipeMessage) => listeners.get(pipe)?.(m), request: (r: LoopbackRequest) => loopback?.(r) }
  }

  it('a pipe is a byte pipe that ends on close', () => {
    const { api, pipes, emit } = fakeApi()
    const duplex = pipeDuplex(api.pipes, 'p1')
    emit('p1', new Uint8Array([1]))
    const got: Uint8Array[] = []
    duplex.onData((b) => got.push(b))
    const closed = vi.fn()
    duplex.onClose(closed)
    duplex.write(new Uint8Array([2]))
    emit('p1', { t: 'close', reason: 'bye' })
    expect(got).toEqual([new Uint8Array([1])])
    expect(pipes.write).toHaveBeenCalledWith('p1', new Uint8Array([2]))
    expect(closed).toHaveBeenCalledWith('bye')
  })

  it('answers loopback requests through the workspace connection', async () => {
    const { api, pipes, emit, request } = fakeApi()
    const upstream = fakeDuplex()
    const dialLoopback = vi.fn(async () => upstream)
    serveLoopbackRequests((runtimeId) => (runtimeId === 'rt' ? { dialLoopback } : undefined), api)
    request({ runtimeId: 'rt', port: 3000, pipe: 'lp' })
    await tick()
    expect(dialLoopback).toHaveBeenCalledWith(3000)
    expect(pipes.open).toHaveBeenCalledWith('lp')
    emit('lp', new Uint8Array([7]))
    expect(upstream.written).toEqual([new Uint8Array([7])])
    upstream.push(new Uint8Array([8]))
    expect(pipes.write).toHaveBeenCalledWith('lp', new Uint8Array([8]))

    request({ runtimeId: 'other', port: 3000, pipe: 'lp2' })
    expect(pipes.close).toHaveBeenCalledWith('lp2', 'not connected to runtime other')
  })
})

describe('main pipes memory', () => {
  it('posts a tight copy, not a view that drags its whole backing buffer along', () => {
    const posted: Uint8Array[] = []
    const port = Object.assign(new EventEmitter(), { start() {}, close() {}, postMessage: (m: unknown) => { posted.push(m as Uint8Array) } }) as unknown as MainPort
    const duplex = fakeDuplex()
    bridgePipe(duplex, port)
    duplex.push(new Uint8Array(new ArrayBuffer(65536), 100, 4))
    expect(posted[0].buffer.byteLength).toBe(4)
  })
})
