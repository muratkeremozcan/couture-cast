// Learning path Step 54: the latency proxy that puts production's round trip in front of the
// test database (6.5-INT-030 calibrates it through Prisma). These checks hold the transport to
// its minimum delay where a Prisma calibration on a warm connection cannot reach: the first
// traffic on a fresh connection and payloads split into many chunks.
import {
  connect,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { latencyProxy } from './latency-proxy.js'

const ONE_WAY_MS = 15.5
// The proxy re-checks each chunk's due time before it forwards it, so a chunk is never early.
// 0.5 ms covers clock rounding between the proxy's timestamps and these.
const TOLERANCE_MS = 0.5

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

/** A TCP server that writes every chunk straight back, behind a proxy with ONE_WAY_MS each way. */
async function echoBehindProxy() {
  const sockets = new Set<Socket>()
  const echo: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('data', (chunk) => socket.write(chunk))
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
  const port = (echo.address() as AddressInfo).port
  const proxy = latencyProxy(`postgresql://echo@127.0.0.1:${port}/echo`, ONE_WAY_MS)
  const proxied = new URL(await proxy.listen())
  cleanups.push(async () => {
    await proxy.close()
    sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) => echo.close(() => resolve()))
  })
  return { port: Number(proxied.port) }
}

/** Opens a fresh connection to the proxy and resolves once it is connected. */
async function open(port: number) {
  const socket = connect(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  cleanups.push(() => {
    socket.destroy()
    return Promise.resolve()
  })
  return socket
}

describe('latency proxy transport', () => {
  it('holds the first bytes on a fresh connection for a full round trip', async () => {
    const { port } = await echoBehindProxy()
    const socket = await open(port)
    const sent = performance.now()
    const arrived = new Promise<number>((resolve) =>
      socket.once('data', () => resolve(performance.now()))
    )
    socket.write('first traffic')
    expect((await arrived) - sent).toBeGreaterThanOrEqual(2 * ONE_WAY_MS - TOLERANCE_MS)
  })

  it('holds every chunk of a large payload for a full round trip', async () => {
    const { port } = await echoBehindProxy()
    const socket = await open(port)
    // 32 pieces of 64 KiB: the kernel and the proxy split and merge them into many chunks.
    const pieceBytes = 64 * 1024
    const pieces = 32
    const total = pieceBytes * pieces
    const sentAt: number[] = []
    const holds: number[] = []
    let received = 0
    const done = new Promise<void>((resolve) => {
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length
        // The last byte of this chunk was the latest written, so it bounds the hold from below.
        const piece = Math.floor((received - 1) / pieceBytes)
        holds.push(performance.now() - sentAt[piece]!)
        if (received >= total) resolve()
      })
    })
    for (let piece = 0; piece < pieces; piece++) {
      sentAt.push(performance.now())
      socket.write(Buffer.alloc(pieceBytes, piece))
    }
    await done
    expect(received).toBe(total)
    expect(holds.length).toBeGreaterThan(1)
    expect(Math.min(...holds)).toBeGreaterThanOrEqual(2 * ONE_WAY_MS - TOLERANCE_MS)
  })
})
