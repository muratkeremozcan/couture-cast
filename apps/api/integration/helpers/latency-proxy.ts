// A TCP proxy in front of the test database that delays every chunk by a fixed one-way time in
// each direction, in order, so a statement costs one production round trip. Production measured
// 30.7 ms p50 per statement from the hosted community worker to its pooler on 2026-11-11.
import { connect, createServer, type AddressInfo, type Socket } from 'node:net'

/** Forwards chunks in arrival order, each no earlier than `delayMs` after it arrived. */
function delayedPipe(from: Socket, to: Socket, delayMs: number) {
  const queue: { at: number; chunk: Buffer }[] = []
  let timer: NodeJS.Timeout | undefined
  const flush = () => {
    timer = undefined
    const now = performance.now()
    while (queue.length && queue[0]!.at <= now) to.write(queue.shift()!.chunk)
    if (queue.length) timer = setTimeout(flush, Math.max(0, queue[0]!.at - now))
  }
  from.on('data', (chunk: Buffer) => {
    queue.push({ at: performance.now() + delayMs, chunk })
    timer ??= setTimeout(flush, delayMs)
  })
  from.on('close', () => clearTimeout(timer))
}

export function latencyProxy(target: string, oneWayMs: number) {
  const url = new URL(target)
  const sockets = new Set<Socket>()
  const server = createServer((client) => {
    const upstream = connect(Number(url.port || 5432), url.hostname)
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    }
    const close = () => {
      client.destroy()
      upstream.destroy()
    }
    for (const socket of [client, upstream]) {
      socket.on('error', close)
      socket.on('close', close)
    }
    delayedPipe(client, upstream, oneWayMs)
    delayedPipe(upstream, client, oneWayMs)
  })
  return {
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const proxied = new URL(target)
      proxied.hostname = '127.0.0.1'
      proxied.port = String((server.address() as AddressInfo).port)
      return proxied.toString()
    },
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy())
        server.close(() => resolve())
      }),
  }
}
